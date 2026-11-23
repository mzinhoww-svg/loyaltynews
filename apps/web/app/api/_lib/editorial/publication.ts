// Registro da publicação editorial (applyPublication → PgEditorialStore.commitPublication) como rota do Studio.
// POST /api/studio/editorial/articles/:articleId/publication  { receiptId, url }
// - atrás da flag `publicacaoPortal` (desligada por padrão; ADR-017: publicação disparada pelo CMS/Studio): desligada,
//   nada é lido nem gravado. `publicacaoAutonoma` é de disparo por agentes/workers e NÃO libera esta rota;
// - sessão + MFA (dispatcher) e papel com `materias:publish` (admin, editor-chefe);
// - o recibo precisa existir em publication_receipts para ESTA matéria, ser da VERSÃO atual da matéria e carregar o
//   sha do conteúdo aprovado (ADR-017: `draftContentSha256` = publishedContentSha256 do RASCUNHO do CMS; o mesmo valor vai na
//   chave `article.published:{id}:{sha}` e em publication.contentSha256);
//   recibo de versão antiga ou de outro conteúdo ⇒ 409 sem efeito; e a identidade de publicação do recibo precisa ser a
//   de quem chama (ADR-008);
// - a data da publicação é a do servidor; `isMock`, `publishedAt` e qualquer campo extra são RECUSADOS (sem mock em produção);
// - idempotente pela chave do outbox do produtor (`article.published:{id}:{sha}`): repetir devolve 200, sem novos efeitos;
// - a gravação é UMA transação (matéria publicada + auditoria + outbox) ou nada.
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { apiError } from '@ln/contracts';
import type { FlagState } from '@ln/contracts';
import { schema } from '@ln/db';
import { applyPublication, draftContentSha256, type ApiResponse, type HandlerCtx } from '@ln/editorial';
import type { Db } from '@ln/auth';
import { HttpUrl } from '../schemas';
import { HttpError, newId } from '../http';

export type PublicationCtx = HandlerCtx & { flags: FlagState; db: Db };

const Input = z.strictObject({
  articleId: z.string().min(1).max(128),
  receiptId: z.string().trim().min(1).max(128),
  url: HttpUrl,
});

const err = (status: number, code: string, message: string, details?: unknown): ApiResponse<never> => ({ status, body: apiError(code, message, details) });

export async function registerPublication(ctx: PublicationCtx, input: unknown): Promise<ApiResponse<unknown>> {
  if (!ctx.flags.publicacaoPortal) {
    return err(403, 'FEATURE_DISABLED', 'Registro de publicação desligado (flag publicacaoPortal).');
  }
  const actor = ctx.actor;
  if (!actor) return err(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  const p = Input.safeParse(input);
  if (!p.success) return err(400, 'VALIDATION_ERROR', 'Entrada inválida.', p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const { articleId, receiptId, url } = p.data;

  const [receipt] = await ctx.db
    .select({
      identidade: schema.publicationReceipts.identidadePublicacao,
      versao: schema.publicationReceipts.versao,
      sha: schema.publicationReceipts.conteudoSha256,
    })
    .from(schema.publicationReceipts)
    .where(and(eq(schema.publicationReceipts.id, receiptId), eq(schema.publicationReceipts.articleId, articleId)));
  if (!receipt) return err(409, 'RECEIPT_NOT_FOUND', 'Recibo inexistente para esta matéria.');
  if (receipt.identidade !== actor.userId) return err(403, 'NOT_PUBLISHER_IDENTITY', 'Só a identidade de publicação do recibo registra esta publicação.');

  // O recibo tem de provar ESTA versão e ESTE conteúdo (um recibo antigo da mesma matéria não registra conteúdo novo).
  const [art] = await ctx.db.select({ versao: schema.articles.versao }).from(schema.articles).where(eq(schema.articles.id, articleId));
  if (!art || receipt.versao !== art.versao) {
    return err(409, 'RECEIPT_STALE', 'O recibo é de outra versão da matéria.', { versaoDoRecibo: receipt.versao, versaoDaMateria: art?.versao ?? null });
  }
  const rec = await ctx.store.getArticle(articleId);
  if (rec?.draft) {
    // já publicada com este recibo: vale o hash gravado na publicação; senão, o do corpo aprovado agora
    const approvedSha = rec.status === 'publicado' && rec.publication ? rec.publication.contentSha256 : draftContentSha256(rec.draft);
    if (receipt.sha !== approvedSha) return err(409, 'RECEIPT_CONTENT_MISMATCH', 'O recibo não corresponde ao conteúdo aprovado da matéria.');
  }

  const r = await applyPublication(ctx.store, { articleId, receiptId, url, publishedAt: ctx.now().toISOString(), expectedContentSha256: receipt.sha });
  if (!r.ok) {
    const status = { not_found: 404, invalid_input: 400, not_approved: 409, gate_failed: 409, no_draft: 409, receipt_stale: 409, slug_immutable: 409, slug_taken: 409 }[r.code];
    const code = r.code === 'receipt_stale' ? 'RECEIPT_CONTENT_MISMATCH' : r.code.toUpperCase();
    return err(status, code, r.message, r.findings);
  }
  // A projeção em `articles` passa a 'publicado' NA MESMA transação do commitPublication (o dispatcher abre a transação
  // e a loja está ligada a ela). Sem linha aprovada/publicada, a publicação inteira é desfeita (lança ⇒ rollback).
  const pub = r.record.publication;
  const [proj] = await ctx.db
    .select({ status: schema.articles.status, slug: schema.articles.slug })
    .from(schema.articles)
    .where(eq(schema.articles.id, articleId));
  if (!proj || (proj.status !== 'aprovado' && proj.status !== 'publicado')) {
    throw new HttpError(409, 'PROJECTION_NOT_APPROVED', 'A projeção em articles não está aprovada para este id; emita o recibo antes.');
  }
  if (proj.status === 'aprovado' && pub) {
    await ctx.db
      .update(schema.articles)
      .set({ status: 'publicado', publicadoEm: new Date(pub.publishedAt) })
      .where(and(eq(schema.articles.id, articleId), inArray(schema.articles.status, ['aprovado'])));
    await ctx.db.insert(schema.articleTransitions).values({
      id: newId(), articleId, de: 'aprovado', para: 'publicado', actorId: actor.userId, nota: null, receiptId, at: new Date(pub.publishedAt),
    });
  }
  return {
    status: r.alreadyPublished ? 200 : 201,
    body: {
      articleId: r.record.articleId,
      status: r.record.status,
      publication: r.record.publication ?? null,
      outbox: r.outbox,
      alreadyPublished: r.alreadyPublished,
    },
  };
}
