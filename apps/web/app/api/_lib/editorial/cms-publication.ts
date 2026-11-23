// Publicação OFICIAL de matéria que existe só no CMS (sem registro no Editorial), pela mesma rota do Studio
// (POST /api/studio/editorial/articles/{id}/publication). Tudo numa transação (o dispatcher abre; falha ⇒ desfaz tudo):
//  - matéria `aprovado` com recibo da versão atual e hash do conteúdo ⇒ `publicado` + histórico + outbox `article.published:{id}:{sha}`;
//  - matéria `publicado`/`corrigido` com revisão de correção APROVADA por este recibo ⇒ nova versão, `corrigido`, aviso no corpo
//    (e no hash), histórico com o aviso como nota pública + outbox `article.corrected:{id}:{sha}`;
//  - repetir o mesmo recibo devolve 200 sem novos efeitos; recibo de outra versão ou de outro conteúdo é recusado sem efeito.
// A flag `publicacaoPortal`, a sessão com MFA, o papel `materias:publish` e a identidade de publicação do recibo já foram
// conferidos por registerPublication antes de chegar aqui.
import { and, eq } from 'drizzle-orm';
import { audit } from '@ln/auth';
import { apiError } from '@ln/contracts';
import { schema } from '@ln/db';
import { INTELLIGENCE_QUEUE, type ApiResponse } from '@ln/editorial';
import { enqueueOutbox } from '@ln/workers/outbox';
import { evidenceIdsOf, gateFailures, rowContentSha } from '../article-core';
import { withRevision, type Revision } from '../correcao';
import { newId } from '../http';
import type { PublicationCtx } from './publication';

const err = (status: number, code: string, message: string, details?: unknown): ApiResponse<never> => ({ status, body: apiError(code, message, details) });

export interface CmsPublicationInput {
  userId: string;
  role: string | undefined;
  receipt: { id: string; versao: number; sha: string };
  articleId: string;
  url: string;
}

export async function publishFromCms(ctx: PublicationCtx, p: CmsPublicationInput): Promise<ApiResponse<unknown>> {
  const db = ctx.db;
  const now = ctx.now();
  const [a] = await db.select().from(schema.articles).where(eq(schema.articles.id, p.articleId)).for('update');
  if (!a) return err(404, 'NOT_FOUND', 'matéria não encontrada');
  const evIds = await evidenceIdsOf(db, a.id);
  const sha = p.receipt.sha;
  const done = (status: 'publicado' | 'corrigido', already: boolean, outbox: 'enqueued' | 'duplicate', publishedAt: Date | null): ApiResponse<unknown> => ({
    status: already ? 200 : 201,
    body: {
      articleId: a.id, status, publication: { receiptId: p.receipt.id, url: p.url, publishedAt: publishedAt?.toISOString() ?? null, contentSha256: sha },
      outbox, alreadyPublished: already,
    },
  });
  const log = (action: string, detalhe: Record<string, unknown>) =>
    audit(db, { actorId: p.userId, actorRole: p.role, action, resource: 'materias', resourceId: a.id, detalhe: { receiptId: p.receipt.id, contentSha256: sha, ...detalhe }, at: now });

  // repetição do MESMO recibo: já registrado; só garante que o outbox existe (idempotente)
  const [prev] = await db
    .select({ para: schema.articleTransitions.para })
    .from(schema.articleTransitions)
    .where(and(eq(schema.articleTransitions.articleId, a.id), eq(schema.articleTransitions.receiptId, p.receipt.id), eq(schema.articleTransitions.para, a.status === 'corrigido' ? 'corrigido' : 'publicado')));
  if (prev && (a.status === 'publicado' || a.status === 'corrigido')) {
    const key = a.status === 'corrigido' ? `article.corrected:${a.id}:${sha}` : `article.published:${a.id}:${sha}`;
    const ob = await enqueueOutbox(db, { queue: INTELLIGENCE_QUEUE, refId: a.id, idempotencyKey: key });
    return done(a.status, true, ob.created ? 'enqueued' : 'duplicate', a.publicadoEm);
  }

  if (a.status === 'aprovado') {
    if (p.receipt.versao !== a.versao) return err(409, 'RECEIPT_STALE', 'O recibo é de outra versão da matéria.', { versaoDoRecibo: p.receipt.versao, versaoDaMateria: a.versao });
    const failures = gateFailures(a, evIds.length);
    if (failures.length) return err(409, 'GATE_FAILED', 'a matéria não passa mais nas regras determinísticas', failures);
    if (sha !== rowContentSha(a, evIds)) return err(409, 'RECEIPT_CONTENT_MISMATCH', 'O recibo não corresponde ao conteúdo aprovado da matéria.');
    const upd = await db
      .update(schema.articles)
      .set({ status: 'publicado', publicadoEm: now })
      .where(and(eq(schema.articles.id, a.id), eq(schema.articles.status, 'aprovado'), eq(schema.articles.versao, a.versao)))
      .returning({ id: schema.articles.id });
    if (!upd[0]) return err(409, 'STATE_CONFLICT', 'A matéria mudou durante a operação; tente de novo.');
    await db.insert(schema.articleTransitions).values({ id: newId(), articleId: a.id, de: 'aprovado', para: 'publicado', actorId: p.userId, nota: null, receiptId: p.receipt.id, at: now });
    const ob = await enqueueOutbox(db, { queue: INTELLIGENCE_QUEUE, refId: a.id, idempotencyKey: `article.published:${a.id}:${sha}` });
    await log('materia.publicada', { versao: a.versao });
    return done('publicado', false, ob.created ? 'enqueued' : 'duplicate', now);
  }

  if (a.status === 'publicado' || a.status === 'corrigido') {
    const [rev] = (await db
      .select()
      .from(schema.articleRevisions)
      .where(and(eq(schema.articleRevisions.articleId, a.id), eq(schema.articleRevisions.receiptId, p.receipt.id), eq(schema.articleRevisions.estado, 'aprovada')))) as Revision[];
    if (!rev) return err(409, 'NOT_APPROVED', `matéria em ${a.status}: só uma revisão de correção aprovada por este recibo pode ser publicada.`);
    if (rev.baseVersao !== a.versao || rev.versao !== p.receipt.versao) {
      return err(409, 'RECEIPT_STALE', 'A matéria mudou depois da revisão ou o recibo é de outra versão.', { versaoDoRecibo: p.receipt.versao, versaoDaRevisao: rev.versao, versaoDaMateria: a.versao });
    }
    const merged = withRevision(a, rev);
    const failures = gateFailures(merged, evIds.length);
    if (failures.length) return err(409, 'GATE_FAILED', 'a matéria corrigida não passa nas regras determinísticas', failures);
    if (sha !== rowContentSha(merged, evIds) || sha !== rev.conteudoSha256) return err(409, 'RECEIPT_CONTENT_MISMATCH', 'O recibo não corresponde ao conteúdo da revisão.');
    const upd = await db
      .update(schema.articles)
      .set({ titulo: merged.titulo, subtitulo: merged.subtitulo, resumo: merged.resumo, corpo: merged.corpo, imagem: merged.imagem, versao: rev.versao, status: 'corrigido' })
      .where(and(eq(schema.articles.id, a.id), eq(schema.articles.versao, a.versao), eq(schema.articles.status, a.status)))
      .returning({ id: schema.articles.id });
    if (!upd[0]) return err(409, 'STATE_CONFLICT', 'A matéria mudou durante a operação; tente de novo.');
    // o aviso é a nota PÚBLICA da correção (a API pública lista as erratas pelas transições `corrigido`)
    await db.insert(schema.articleTransitions).values({ id: newId(), articleId: a.id, de: a.status, para: 'corrigido', actorId: p.userId, nota: rev.aviso, receiptId: p.receipt.id, at: now });
    await db.update(schema.articleRevisions).set({ estado: 'publicada', publicadoEm: now }).where(eq(schema.articleRevisions.id, rev.id));
    const ob = await enqueueOutbox(db, { queue: INTELLIGENCE_QUEUE, refId: a.id, idempotencyKey: `article.corrected:${a.id}:${sha}` });
    await log('materia.corrigida', { versao: rev.versao, casoId: rev.casoId });
    return done('corrigido', false, ob.created ? 'enqueued' : 'duplicate', a.publicadoEm);
  }

  return err(409, 'NOT_APPROVED', `matéria em ${a.status}: só matéria aprovada pode ser registrada como publicada`);
}
