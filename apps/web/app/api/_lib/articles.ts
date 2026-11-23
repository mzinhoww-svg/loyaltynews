// Matérias: CRUD, fontes, transições de estado e recibos de publicação (ADR-008).
// Regras: publicar só a partir de `aprovado`, com recibo da versão atual (hash do conteúdo igual), pela
// papel com permissão `publish` (a identidade de publicação do recibo é o canal `portal`, ADR-017 §5). Conteúdo publicado é imutável;
// `corrigido` registra errata (nota) sobre a versão publicada; corrigir o texto exige despublicar → rascunho.
import { and, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import { canTransition, imageLabel, isImagePublishable, readingTimeMinutes, ImageRights, type ArticleStatus } from '@ln/contracts';
import { can } from '@ln/auth';
import { draftContentSha256 } from '@ln/editorial';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { issueFromEditorial } from './editorial/receipt';
import { issueCorrectionReceipt } from './editorial/fabrica-correction';
import { evidenceIdsOf, gateFailures, PUBLISH_IDENTITY, rowContentSha, type ArticleRow } from './article-core';
import { publicImageOf, publicImagesOf } from './midia';
import { issueRevisionReceipt, openRevision } from './correcao';
import { HttpError, json, newId, parse, Paging, queryObject, readBody, type RouteFn } from './http';
import type { Db } from '@ln/auth';
import {
  ArticleCreate,
  ArticleQuery,
  ArticleSources,
  ArticleTransition,
  ArticleUpdate,
  ReceiptInput,
} from './schemas';

const EDITABLE: readonly ArticleStatus[] = ['rascunho', 'bloqueado'];
const PUBLISH_SET: readonly ArticleStatus[] = ['publicado', 'corrigido', 'despublicado'];
const NOTE_SET: readonly ArticleStatus[] = ['despublicado', 'corrigido', 'bloqueado'];

async function load(db: Db, id: string): Promise<ArticleRow> {
  const [row] = await db.select().from(schema.articles).where(eq(schema.articles.id, id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Matéria não encontrada.');
  return row;
}

async function fontesOf(db: Db, articleId: string) {
  return db
    .select({
      id: schema.evidences.id,
      sourceId: schema.evidences.sourceId,
      url: schema.evidences.url,
      capturadoEm: schema.evidences.capturadoEm,
      sha256: schema.evidences.sha256,
    })
    .from(schema.articleSources)
    .innerJoin(schema.evidences, eq(schema.evidences.id, schema.articleSources.evidenceId))
    .where(eq(schema.articleSources.articleId, articleId))
    .orderBy(asc(schema.evidences.id));
}

/** Imagem só sai pública com base de direito (D08): 'pendente' ou inválida vira null. */
function publishableImage(img: unknown): unknown {
  if (img == null) return null;
  const p = ImageRights.safeParse(img);
  return p.success && isImagePublishable(p.data) ? img : null;
}

/** ADR-018: rótulo visível ("Ilustração conceitual") para ilustração gerada; null nas demais. */
function withLabel(img: unknown): unknown {
  if (img == null || typeof img !== 'object') return img ?? null;
  return { ...(img as object), rotulo: imageLabel(img as { origem: never }) };
}

/** Imagem da LISTAGEM pública: só o que o card precisa (nada de origem, base de direito, edições ou ids internos). */
function imageCard(img: unknown) {
  if (img == null || typeof img !== 'object') return null;
  const i = img as { url?: string; textoAlternativo?: string; credito?: string; origem?: string };
  if (!i.url) return null;
  return { url: i.url, textoAlternativo: i.textoAlternativo ?? '', credito: i.credito ?? '', rotulo: imageLabel({ origem: i.origem as never }) };
}

function serialize(a: ArticleRow, withBody = true) {
  return {
    id: a.id,
    slug: a.slug,
    titulo: a.titulo,
    subtitulo: a.subtitulo,
    resumo: a.resumo,
    tipoConteudo: a.tipoConteudo,
    tempoLeituraMin: readingTimeMinutes(a.corpo),
    editoria: a.editoria,
    status: a.status,
    assinatura: a.assinatura,
    ...(withBody ? { corpo: a.corpo } : {}),
    imagem: a.imagem,
    classeDeDado: a.classeDeDado,
    patrocinado: a.patrocinado,
    rotuloPublieditorial: a.rotuloPublieditorial,
    versao: a.versao,
    publicadoEm: a.publicadoEm,
    criadoEm: a.criadoEm,
  };
}

/**
 * sha do conteúdo aprovado (ADR-017: função ÚNICA `publishedContentSha256`). Com rascunho no CMS editorial (mesmo id),
 * é `draftContentSha256` do RASCUNHO, a fonte da verdade; sem registro editorial (matéria só na tabela `articles`),
 * é calculado sobre a linha de `articles`. Recibo desse segundo caminho não é aceito pela rota de publicação do
 * Editorial (o hash difere: 409 sem efeito).
 */
async function approvedSha(db: Db, a: ArticleRow, evidenceIds: readonly string[]): Promise<string> {
  const rec = await new PgEditorialStore(db).getArticle(a.id);
  if (rec?.draft) return draftContentSha256(rec.draft);
  return rowContentSha(a, evidenceIds);
}

async function receiptFor(db: Db, a: ArticleRow) {
  const [r] = await db
    .select()
    .from(schema.publicationReceipts)
    .where(and(eq(schema.publicationReceipts.articleId, a.id), eq(schema.publicationReceipts.versao, a.versao)));
  return r ?? null;
}

/** Recibo da versão atual E com hash igual ao conteúdo de agora; senão null. */
async function validReceipt(db: Db, a: ArticleRow) {
  const r = await receiptFor(db, a);
  if (!r) return null;
  return r.conteudoSha256 === (await approvedSha(db, a, await evidenceIdsOf(db, a.id))) ? r : null;
}

async function assertEvidences(db: Db, ids: readonly string[]) {
  if (!ids.length) return;
  const found = await db.select({ id: schema.evidences.id }).from(schema.evidences).where(inArray(schema.evidences.id, [...ids]));
  const missing = ids.filter((i) => !found.some((f) => f.id === i));
  if (missing.length) throw new HttpError(422, 'UNKNOWN_EVIDENCE', 'Evidência inexistente.', { ids: missing });
}

async function assertEditoria(db: Db, slug: string) {
  const [e] = await db.select({ slug: schema.editorias.slug }).from(schema.editorias).where(eq(schema.editorias.slug, slug));
  if (!e) throw new HttpError(422, 'UNKNOWN_EDITORIA', 'Editoria inexistente (cadastre-a antes).', { slug });
}

// ---------- leitura (Studio) ----------
export const listArticles: RouteFn = async (_req, c) => {
  const q = parse(ArticleQuery.extend(Paging.shape), queryObject(c.url));
  const where = and(
    q.editoria ? eq(schema.articles.editoria, q.editoria) : undefined,
    q.status ? eq(schema.articles.status, q.status) : undefined,
    q.q ? ilike(schema.articles.titulo, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
  );
  const rows = await c.deps.db
    .select()
    .from(schema.articles)
    .where(where)
    .orderBy(desc(schema.articles.criadoEm), asc(schema.articles.id))
    .limit(q.limit)
    .offset(q.offset);
  const [total] = await c.deps.db.select({ n: count() }).from(schema.articles).where(where);
  return json({ data: rows.map((r) => serialize(r, false)), total: total?.n ?? 0, limit: q.limit, offset: q.offset });
};

export const getArticle: RouteFn = async (_req, c) => {
  const a = await load(c.deps.db, c.params.id ?? '');
  const [fontes, recibo, transicoes] = await Promise.all([
    fontesOf(c.deps.db, a.id),
    receiptFor(c.deps.db, a),
    c.deps.db
      .select()
      .from(schema.articleTransitions)
      .where(eq(schema.articleTransitions.articleId, a.id))
      .orderBy(asc(schema.articleTransitions.at)),
  ]);
  return json({ data: { ...serialize(a), fontes, recibo, transicoes } });
};

// ---------- escrita ----------
export const createArticle: RouteFn = async (req, c) => {
  const b = await readBody(req, ArticleCreate);
  await assertEditoria(c.deps.db, b.editoria);
  await assertEvidences(c.deps.db, b.evidenceIds);
  const id = newId();
  await c.deps.db.transaction(async (tx) => {
    await tx.insert(schema.articles).values({
      id,
      slug: b.slug,
      titulo: b.titulo,
      subtitulo: b.subtitulo ?? null,
      resumo: b.resumo ?? null,
      tipoConteudo: b.tipoConteudo,
      editoria: b.editoria,
      corpo: b.corpo,
      imagem: b.imagem ?? null,
      classeDeDado: b.classeDeDado,
      patrocinado: b.patrocinado,
      rotuloPublieditorial: b.rotuloPublieditorial ?? null,
    });
    if (b.evidenceIds.length) {
      await tx.insert(schema.articleSources).values([...new Set(b.evidenceIds)].map((evidenceId) => ({ articleId: id, evidenceId })));
    }
  });
  return json({ data: serialize(await load(c.deps.db, id)) }, 201, { location: `/api/materias/${id}` });
};

export const updateArticle: RouteFn = async (req, c) => {
  const b = await readBody(req, ArticleUpdate);
  const a = await load(c.deps.db, c.params.id ?? '');
  // ADR-019 §c.5: matéria publicada só muda por revisão de correção (caso aceito); a página fica como está até a publicação oficial
  if (a.status === 'publicado' || a.status === 'corrigido') return openRevision(c, a, b);
  if (b.casoCorrecaoId !== undefined) throw new HttpError(422, 'VALIDATION_ERROR', 'casoCorrecaoId só vale para matéria já publicada.', [{ path: 'casoCorrecaoId', message: 'matéria não publicada' }]);
  if (!EDITABLE.includes(a.status)) throw new HttpError(409, 'NOT_EDITABLE', `Matéria em ${a.status} não é editável.`);
  if (b.versaoEsperada !== a.versao) throw new HttpError(409, 'VERSION_MISMATCH', 'A matéria mudou; recarregue.', { versaoAtual: a.versao });
  if (b.editoria) await assertEditoria(c.deps.db, b.editoria);
  const patrocinado = b.patrocinado ?? a.patrocinado;
  const rotulo = b.rotuloPublieditorial === undefined ? a.rotuloPublieditorial : b.rotuloPublieditorial;
  if (patrocinado && !rotulo) throw new HttpError(422, 'VALIDATION_ERROR', 'Conteúdo pago sempre rotulado (F-074).', [{ path: 'rotuloPublieditorial', message: 'obrigatório' }]);
  const tipo = b.tipoConteudo ?? a.tipoConteudo;
  if (tipo === 'patrocinado' && !patrocinado) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Tipo patrocinado exige patrocinado=true (rótulo).', [{ path: 'patrocinado', message: 'obrigatório' }]);
  }
  const { versaoEsperada, ...fields } = b;
  delete fields.casoCorrecaoId; // só vale para matéria publicada (rejeitado acima)
  const updated = await c.deps.db
    .update(schema.articles)
    .set({ ...fields, versao: a.versao + 1 })
    .where(and(eq(schema.articles.id, a.id), eq(schema.articles.versao, versaoEsperada), inArray(schema.articles.status, [...EDITABLE])))
    .returning();
  if (!updated[0]) throw new HttpError(409, 'VERSION_MISMATCH', 'A matéria mudou; recarregue.');
  return json({ data: serialize(updated[0]) });
};

export const setArticleSources: RouteFn = async (req, c) => {
  const b = await readBody(req, ArticleSources);
  const a = await load(c.deps.db, c.params.id ?? '');
  if (!EDITABLE.includes(a.status)) throw new HttpError(409, 'NOT_EDITABLE', `Matéria em ${a.status} não é editável.`);
  if (b.versaoEsperada !== a.versao) throw new HttpError(409, 'VERSION_MISMATCH', 'A matéria mudou; recarregue.', { versaoAtual: a.versao });
  const ids = [...new Set(b.evidenceIds)];
  await assertEvidences(c.deps.db, ids);
  const next = await c.deps.db.transaction(async (tx) => {
    const upd = await tx
      .update(schema.articles)
      .set({ versao: a.versao + 1 })
      .where(and(eq(schema.articles.id, a.id), eq(schema.articles.versao, a.versao), inArray(schema.articles.status, [...EDITABLE])))
      .returning();
    if (!upd[0]) throw new HttpError(409, 'VERSION_MISMATCH', 'A matéria mudou; recarregue.');
    await tx.delete(schema.articleSources).where(eq(schema.articleSources.articleId, a.id));
    if (ids.length) await tx.insert(schema.articleSources).values(ids.map((evidenceId) => ({ articleId: a.id, evidenceId })));
    return upd[0];
  });
  return json({ data: { ...serialize(next), fontes: await fontesOf(c.deps.db, a.id) } });
};

export const deleteArticle: RouteFn = async (_req, c) => {
  const a = await load(c.deps.db, c.params.id ?? '');
  if (a.status !== 'rascunho') throw new HttpError(409, 'NOT_DELETABLE', 'Só rascunho pode ser excluído.');
  await c.deps.db.transaction(async (tx) => {
    await tx.delete(schema.articleSources).where(eq(schema.articleSources.articleId, a.id));
    await tx.delete(schema.articles).where(and(eq(schema.articles.id, a.id), eq(schema.articles.status, 'rascunho')));
  });
  return new Response(null, { status: 204 });
};

// ---------- recibo de publicação ----------
export const issueReceipt: RouteFn = async (req, c) => {
  const b = await readBody(req, ReceiptInput);
  // Com rascunho no CMS editorial (mesmo id), o recibo nasce DELE (ADR-017 §4): upsert em articles + recibo numa transação.
  const rec = await new PgEditorialStore(c.deps.db).getArticle(c.params.id ?? '');
  if (rec && b.correcao) return issueCorrectionReceipt(c, c.params.id ?? '', b, b.correcao); // recibo da versão corrigida (ADR-019 §c.5)
  if (b.correcao) throw new HttpError(409, 'NOT_FACTORY_ARTICLE', 'correcao só vale para matéria da Fábrica; a do CMS usa PATCH com casoCorrecaoId.');
  if (rec) return issueFromEditorial(c, c.params.id ?? '', b, rec);
  if (b.versao === undefined) throw new HttpError(400, 'VALIDATION_ERROR', 'Entrada inválida.', [{ path: 'versao', message: 'obrigatória' }]);
  const a = await load(c.deps.db, c.params.id ?? '');
  if (a.status === 'publicado' || a.status === 'corrigido') return issueRevisionReceipt(c, a, b); // recibo da revisão de correção (ADR-019 §c.5)
  if (a.status !== 'em_checagem') throw new HttpError(409, 'BAD_STATE', 'Recibo só é emitido para matéria em checagem.');
  if (b.versao !== a.versao) throw new HttpError(409, 'VERSION_MISMATCH', 'Versão do recibo difere da matéria.', { versaoAtual: a.versao });
  const evIds = await evidenceIdsOf(c.deps.db, a.id);
  const failures = gateFailures(a, evIds.length);
  if (failures.length) throw new HttpError(422, 'GATES_FAILED', 'A matéria não passa nas regras determinísticas.', failures);
  const hash = await approvedSha(c.deps.db, a, evIds);
  const existing = await receiptFor(c.deps.db, a);
  if (existing) {
    if (existing.conteudoSha256 === hash) return json({ data: existing }, 200);
    throw new HttpError(409, 'RECEIPT_STALE', 'Já existe recibo desta versão com outro conteúdo.');
  }
  const [r] = await c.deps.db
    .insert(schema.publicationReceipts)
    .values({
      id: newId(),
      articleId: a.id,
      versao: a.versao,
      conteudoSha256: hash,
      checagens: b.checagens,
      aprovador: c.session?.userId ?? 'desconhecido',
      identidadePublicacao: PUBLISH_IDENTITY,
      emitidoEm: c.deps.now(),
    })
    .returning();
  return json({ data: r }, 201);
};

// ---------- transições ----------
export const transitionArticle: RouteFn = async (req, c) => {
  const b = await readBody(req, ArticleTransition);
  const a = await load(c.deps.db, c.params.id ?? '');
  const session = c.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  if (!canTransition(a.status, b.para)) {
    throw new HttpError(409, 'BAD_TRANSITION', `Transição ${a.status} → ${b.para} não permitida.`);
  }
  if (b.versaoEsperada !== undefined && b.versaoEsperada !== a.versao) {
    throw new HttpError(409, 'VERSION_MISMATCH', 'A matéria mudou; recarregue.', { versaoAtual: a.versao });
  }
  if (PUBLISH_SET.includes(b.para) && !can(session.role, 'materias', 'publish')) {
    throw new HttpError(403, 'FORBIDDEN', 'Sem permissão para publicar, despublicar ou corrigir.');
  }
  // Publicar e corrigir só pelo fluxo oficial (POST /api/studio/editorial/articles/{id}/publication): lá a flag, o recibo, o hash do
  // conteúdo, a projeção, a auditoria e o outbox (`article.published`/`article.corrected`) saem na MESMA transação. Esta rota genérica
  // nunca muda a matéria para 'publicado' nem 'corrigido' (nem com a flag ligada): recusa sem efeito algum.
  if (b.para === 'publicado' || b.para === 'corrigido') {
    if (!c.deps.flags.publicacaoPortal) throw new HttpError(403, 'FEATURE_DISABLED', 'Publicação desligada (flag publicacaoPortal).');
    throw new HttpError(409, 'USE_PUBLICATION_ROUTE', 'Publique pela rota de publicação do Editorial; esta rota não publica nem corrige.', {
      rota: `/api/studio/editorial/articles/${a.id}/publication`,
    });
  }
  if (NOTE_SET.includes(b.para) && !b.nota) throw new HttpError(422, 'NOTE_REQUIRED', 'Esta transição exige uma nota.');

  const evIds = await evidenceIdsOf(c.deps.db, a.id);
  let receiptId: string | null = null;
  if (b.para === 'em_checagem' && evIds.length < 1) {
    throw new HttpError(422, 'GATES_FAILED', 'Matéria sem fontes não vai para checagem.', ['fontes: ao menos uma evidência']);
  }
  if (b.para === 'aprovado') {
    const failures = gateFailures(a, evIds.length);
    if (failures.length) throw new HttpError(422, 'GATES_FAILED', 'A matéria não passa nas regras determinísticas.', failures);
    const receipt = await validReceipt(c.deps.db, a);
    if (!receipt) throw new HttpError(409, 'RECEIPT_REQUIRED', 'Exige recibo válido da versão atual.');
    receiptId = receipt.id;
  }

  const now = c.deps.now();
  const updated = await c.deps.db.transaction(async (tx) => {
    const upd = await tx
      .update(schema.articles)
      .set({ status: b.para })
      .where(and(eq(schema.articles.id, a.id), eq(schema.articles.status, a.status), eq(schema.articles.versao, a.versao)))
      .returning();
    if (!upd[0]) throw new HttpError(409, 'STATE_CONFLICT', 'A matéria mudou durante a operação; tente de novo.');
    await tx.insert(schema.articleTransitions).values({
      id: newId(),
      articleId: a.id,
      de: a.status,
      para: b.para,
      actorId: session.userId,
      nota: b.nota ?? null,
      receiptId,
      at: now,
    });
    return upd[0];
  });
  return json({ data: serialize(updated) });
};

// ---------- público (Portal): só publicado/corrigido ----------
const PUBLIC_STATUS = ['publicado', 'corrigido'] as const;

type ArticleRow2 = typeof schema.articles.$inferSelect;

/** Cartão público da matéria (o MESMO formato da listagem `/api/publico/materias`): serve a listagem e a home resolvida em `/api/publico/site`. */
export async function publicCards(db: Db, rows: ArticleRow2[], now: Date) {
  const imagens = await publicImagesOf(db, rows.map((r) => publishableImage(r.imagem)), now);
  return rows.map((r, i) => ({
    slug: r.slug,
    titulo: r.titulo,
    subtitulo: r.subtitulo,
    resumo: r.resumo,
    tipoConteudo: r.tipoConteudo,
    tempoLeituraMin: readingTimeMinutes(r.corpo),
    editoria: r.editoria,
    assinatura: r.assinatura,
    patrocinado: r.patrocinado,
    rotuloPublieditorial: r.rotuloPublieditorial,
    publicadoEm: r.publicadoEm,
    corrigida: r.status === 'corrigido',
    imagem: imageCard(imagens[i]),
  }));
}

/** Matérias que o público pode ver: publicado/corrigido, classe `public`. */
export const publicArticlesWhere = (...extra: Array<ReturnType<typeof eq> | undefined>) =>
  and(inArray(schema.articles.status, [...PUBLIC_STATUS]), sql`${schema.articles.classeDeDado} = 'public'`, ...extra);

export const publicListArticles: RouteFn = async (_req, c) => {
  const q = parse(ArticleQuery.pick({ editoria: true, q: true }).extend(Paging.shape), queryObject(c.url));
  const where = and(
    inArray(schema.articles.status, [...PUBLIC_STATUS]),
    sql`${schema.articles.classeDeDado} = 'public'`,
    q.editoria ? eq(schema.articles.editoria, q.editoria) : undefined,
    q.q ? ilike(schema.articles.titulo, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
  );
  const rows = await c.deps.db
    .select()
    .from(schema.articles)
    .where(where)
    .orderBy(desc(schema.articles.publicadoEm), asc(schema.articles.id))
    .limit(q.limit)
    .offset(q.offset);
  const [total] = await c.deps.db.select({ n: count() }).from(schema.articles).where(where);
  return json(
    {
      data: await publicCards(c.deps.db, rows, c.deps.now()),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
    },
    200,
    { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
  );
};

export const publicGetArticle: RouteFn = async (_req, c) => {
  const [a] = await c.deps.db
    .select()
    .from(schema.articles)
    .where(and(eq(schema.articles.slug, c.params.slug ?? ''), inArray(schema.articles.status, [...PUBLIC_STATUS]), sql`${schema.articles.classeDeDado} = 'public'`));
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Matéria não encontrada.');
  const [fontes, erratas] = await Promise.all([
    fontesOf(c.deps.db, a.id),
    c.deps.db
      .select({ nota: schema.articleTransitions.nota, em: schema.articleTransitions.at })
      .from(schema.articleTransitions)
      .where(and(eq(schema.articleTransitions.articleId, a.id), eq(schema.articleTransitions.para, 'corrigido')))
      .orderBy(asc(schema.articleTransitions.at)),
  ]);
  // Campos públicos explícitos: nada interno (id, status, versão, classe de dado) sai por aqui.
  const pub = {
    slug: a.slug,
    titulo: a.titulo,
    subtitulo: a.subtitulo,
    resumo: a.resumo,
    tipoConteudo: a.tipoConteudo,
    tempoLeituraMin: readingTimeMinutes(a.corpo),
    editoria: a.editoria,
    assinatura: a.assinatura,
    corpo: a.corpo,
    imagem: withLabel(await publicImageOf(c.deps.db, publishableImage(a.imagem), c.deps.now())),
    patrocinado: a.patrocinado,
    rotuloPublieditorial: a.rotuloPublieditorial,
    publicadoEm: a.publicadoEm,
  };
  return json(
    { data: { ...pub, fontes: fontes.map((f) => ({ sourceId: f.sourceId, url: f.url, capturadoEm: f.capturadoEm, sha256: f.sha256 })), erratas } },
    200,
    { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
  );
};
