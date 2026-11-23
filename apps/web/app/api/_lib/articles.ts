// Matérias: CRUD, fontes, transições de estado e recibos de publicação (ADR-008).
// Regras: publicar só a partir de `aprovado`, com recibo da versão atual (hash do conteúdo igual), pela
// identidade de publicação do recibo e por papel com permissão `publish`. Conteúdo publicado é imutável;
// `corrigido` registra errata (nota) sobre a versão publicada; corrigir o texto exige despublicar → rascunho.
import { and, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import { ASSINATURA, canTransition, isImagePublishable, readingTimeMinutes, ImageRights, type ArticleStatus } from '@ln/contracts';
import { can } from '@ln/auth';
import { contentSha256 } from './content-hash';
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

type ArticleRow = typeof schema.articles.$inferSelect;
const EDITABLE: readonly ArticleStatus[] = ['rascunho', 'bloqueado'];
const PUBLISH_SET: readonly ArticleStatus[] = ['publicado', 'corrigido', 'despublicado'];
const NOTE_SET: readonly ArticleStatus[] = ['despublicado', 'corrigido', 'bloqueado'];

async function load(db: Db, id: string): Promise<ArticleRow> {
  const [row] = await db.select().from(schema.articles).where(eq(schema.articles.id, id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Matéria não encontrada.');
  return row;
}

async function evidenceIdsOf(db: Db, articleId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.articleSources.evidenceId })
    .from(schema.articleSources)
    .where(eq(schema.articleSources.articleId, articleId));
  return rows.map((r) => r.id).sort();
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

/** Regras determinísticas (sem modelo): o que impede aprovar ou publicar. Vazio = passou. */
export function gateFailures(a: ArticleRow, evidenceCount: number): string[] {
  const f: string[] = [];
  if (evidenceCount < 1) f.push('fontes: ao menos uma evidência');
  if (a.assinatura !== ASSINATURA) f.push('assinatura institucional');
  if (!a.resumo) f.push('resumo obrigatório (até 300 caracteres)');
  if (a.patrocinado && !a.rotuloPublieditorial) f.push('conteúdo pago sem rótulo');
  if (a.classeDeDado !== 'public') f.push(`classe de dado ${a.classeDeDado} não é publicável`);
  if (a.imagem != null) {
    const img = ImageRights.safeParse(a.imagem);
    if (!img.success) f.push('imagem inválida');
    else if (!isImagePublishable(img.data)) f.push('imagem sem base de direito');
  }
  return f;
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
  return r.conteudoSha256 === contentSha256(a, await evidenceIdsOf(db, a.id)) ? r : null;
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
  const a = await load(c.deps.db, c.params.id ?? '');
  if (a.status !== 'em_checagem') throw new HttpError(409, 'BAD_STATE', 'Recibo só é emitido para matéria em checagem.');
  if (b.versao !== a.versao) throw new HttpError(409, 'VERSION_MISMATCH', 'Versão do recibo difere da matéria.', { versaoAtual: a.versao });
  const evIds = await evidenceIdsOf(c.deps.db, a.id);
  const failures = gateFailures(a, evIds.length);
  if (failures.length) throw new HttpError(422, 'GATES_FAILED', 'A matéria não passa nas regras determinísticas.', failures);
  const hash = contentSha256(a, evIds);
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
      identidadePublicacao: b.identidadePublicacao ?? c.session?.userId ?? 'desconhecido',
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
  if (NOTE_SET.includes(b.para) && !b.nota) throw new HttpError(422, 'NOTE_REQUIRED', 'Esta transição exige uma nota.');

  const evIds = await evidenceIdsOf(c.deps.db, a.id);
  let receiptId: string | null = null;
  if (b.para === 'em_checagem' && evIds.length < 1) {
    throw new HttpError(422, 'GATES_FAILED', 'Matéria sem fontes não vai para checagem.', ['fontes: ao menos uma evidência']);
  }
  if (b.para === 'aprovado' || b.para === 'publicado' || b.para === 'corrigido') {
    const failures = gateFailures(a, evIds.length);
    if (failures.length) throw new HttpError(422, 'GATES_FAILED', 'A matéria não passa nas regras determinísticas.', failures);
    const receipt = await validReceipt(c.deps.db, a);
    if (!receipt) throw new HttpError(409, 'RECEIPT_REQUIRED', 'Exige recibo válido da versão atual.');
    receiptId = receipt.id;
    if (b.para === 'publicado' && receipt.identidadePublicacao !== session.userId) {
      throw new HttpError(403, 'NOT_PUBLISHER_IDENTITY', 'Só a identidade de publicação do recibo publica esta matéria.');
    }
  }

  const now = c.deps.now();
  const updated = await c.deps.db.transaction(async (tx) => {
    const upd = await tx
      .update(schema.articles)
      .set({ status: b.para, ...(b.para === 'publicado' ? { publicadoEm: now } : {}) })
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
      data: rows.map((r) => ({
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
      })),
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
    imagem: a.imagem,
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
