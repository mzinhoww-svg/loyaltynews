// Emissão do recibo a partir do RASCUNHO aprovado do CMS editorial (ADR-017 §4).
// `articles` é a PROJEÇÃO do conteúdo aprovado, nunca guarda rascunho: numa única transação, upsert em `articles`
// (id = rec.articleId, slug do rascunho, status 'aprovado', campos de toPublishableContent, versão própria da projeção),
// projeção das fontes (sources/evidences/article_sources) e o recibo com conteudoSha256 = draftContentSha256(rec).
// Rascunho que não está `aprovado` ⇒ 409 sem efeito. O estado `publicado` só vem da rota de publicação.
// Idempotente: mesmo conteúdo já com recibo na versão atual ⇒ devolve o recibo existente (200). Conteúdo novo ⇒ versão + 1.
import { and, eq } from 'drizzle-orm';
import { ImageRights, isImagePublishable } from '@ln/contracts';
import { schema } from '@ln/db';
import { draftContentSha256, toPublishableContent, type ArticleRecord } from '@ln/editorial';
import { sourceRegistry } from './index';
import type { Db } from '@ln/auth';
import { HttpError, json, newId, type RouteCtx } from '../http';
import { PUBLISH_IDENTITY } from '../article-core';

export interface EditorialReceiptInput {
  versao?: number;
  checagens: unknown;
}

/** Regras determinísticas do conteúdo projetado (as de matéria, sobre o conteúdo publicável). */
export function contentFailures(c: ReturnType<typeof toPublishableContent>): string[] {
  const f: string[] = [];
  if (c.classeDeDado !== 'public') f.push(`classe de dado ${c.classeDeDado} não é publicável`);
  if (c.patrocinado && !c.rotuloPublieditorial) f.push('conteúdo pago sem rótulo');
  if (!c.resumo) f.push('resumo obrigatório (até 300 caracteres)');
  if (c.imagem != null) {
    const img = ImageRights.safeParse(c.imagem);
    if (!img.success) f.push('imagem inválida');
    else if (!isImagePublishable(img.data)) f.push('imagem sem base de direito');
  }
  return f;
}

/**
 * Fontes do rascunho: projeta as evidências CITADAS (sources/evidences) e refaz os vínculos da matéria (article_sources).
 * Fonte da Fábrica entra com o MESMO id e origem 'fabrica' (ADR-019 §d); nome e URL vêm do registro a cada projeção; linha 'cms'
 * com o mesmo id ⇒ 409 SOURCE_ID_CONFLICT e a transação inteira falha.
 */
export async function projectSources(tx: Db, id: string, rec: ArticleRecord): Promise<void> {
  const draft = rec.draft!;
  const cited = new Set(draft.evidenceIds);
  for (const e of rec.evidences.filter((x) => cited.has(x.id))) {
    const src = sourceRegistry.get(e.sourceId);
    const fonte = { nome: src?.name ?? e.sourceId, url: src ? `https://${src.host}${src.pathPrefix ?? ''}` : e.url };
    const up = await tx
      .insert(schema.sources)
      .values({ id: e.sourceId, ...fonte, tipo: 'site', acesso: 'publico', termosRevisados: false, ativo: false, origem: 'fabrica' })
      .onConflictDoUpdate({ target: schema.sources.id, set: fonte, setWhere: eq(schema.sources.origem, 'fabrica') })
      .returning({ id: schema.sources.id });
    if (up.length === 0) {
      throw new HttpError(409, 'SOURCE_ID_CONFLICT', 'Já existe uma fonte do CMS com o mesmo id de uma fonte da Fábrica; renomeie ou remova a do CMS.', { sourceId: e.sourceId });
    }
    await tx
      .insert(schema.evidences)
      .values({ id: e.id, sourceId: e.sourceId, url: e.url, capturadoEm: new Date(e.fetchedAt), sha256: e.contentSha256 })
      .onConflictDoNothing();
  }
  await tx.delete(schema.articleSources).where(eq(schema.articleSources.articleId, id));
  const links = rec.evidences.filter((x) => cited.has(x.id)).map((e) => ({ articleId: id, evidenceId: e.id }));
  if (links.length) await tx.insert(schema.articleSources).values(links);
}

export async function issueFromEditorial(c: RouteCtx, id: string, body: EditorialReceiptInput, rec: ArticleRecord): Promise<Response> {
  if (rec.status !== 'aprovado' || !rec.draft) {
    throw new HttpError(409, 'NOT_APPROVED', 'Só rascunho aprovado no CMS editorial gera recibo (articles guarda apenas o conteúdo aprovado).');
  }
  const content = toPublishableContent(rec);
  const failures = contentFailures(content);
  if (failures.length) throw new HttpError(422, 'GATES_FAILED', 'O conteúdo aprovado não passa nas regras determinísticas.', failures);
  const sha = draftContentSha256(rec);
  const draft = rec.draft;
  const session = c.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');

  const [editoria] = await c.deps.db.select({ slug: schema.editorias.slug }).from(schema.editorias).where(eq(schema.editorias.slug, content.editoria));
  if (!editoria) throw new HttpError(422, 'UNKNOWN_EDITORIA', 'Editoria inexistente (cadastre-a antes).', { slug: content.editoria });

  return c.deps.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(schema.articles).where(eq(schema.articles.id, id)).for('update');
    if (cur && (cur.status === 'publicado' || cur.status === 'corrigido')) {
      throw new HttpError(409, 'PUBLISHED_IMMUTABLE', `Matéria ${cur.status}: conteúdo publicado é imutável (despublique para reabrir o ciclo).`);
    }
    // recibo da versão atual (se houver): mesmo conteúdo ⇒ idempotente; outro conteúdo ⇒ nova versão; sem recibo ⇒ mantém a versão
    let versao = 1;
    if (cur) {
      const [last] = await tx
        .select()
        .from(schema.publicationReceipts)
        .where(and(eq(schema.publicationReceipts.articleId, id), eq(schema.publicationReceipts.versao, cur.versao)));
      if (last && last.conteudoSha256 === sha && cur.status === 'aprovado') return json({ data: last }, 200);
      versao = last ? cur.versao + 1 : cur.versao;
    }
    if (body.versao !== undefined && body.versao !== versao) {
      throw new HttpError(409, 'VERSION_MISMATCH', 'Versão informada difere da próxima versão da matéria.', { versaoAtual: versao });
    }

    const row = {
      slug: draft.slug, titulo: content.titulo, subtitulo: content.subtitulo ?? null, resumo: content.resumo ?? null,
      tipoConteudo: content.tipoConteudo as (typeof schema.articles.$inferInsert)['tipoConteudo'], editoria: content.editoria,
      status: 'aprovado' as const, corpo: content.corpo, imagem: content.imagem ?? null, classeDeDado: content.classeDeDado,
      patrocinado: content.patrocinado, rotuloPublieditorial: content.rotuloPublieditorial ?? null, versao,
    };
    await tx.insert(schema.articles).values({ id, ...row }).onConflictDoUpdate({ target: schema.articles.id, set: row });

    await projectSources(tx as unknown as Db, id, rec);

    const [receipt] = await tx
      .insert(schema.publicationReceipts)
      .values({
        id: newId(), articleId: id, versao, conteudoSha256: sha, checagens: body.checagens, aprovador: session.userId,
        identidadePublicacao: PUBLISH_IDENTITY, emitidoEm: c.deps.now(),
      })
      .returning();
    return json({ data: receipt }, 201);
  });
}
