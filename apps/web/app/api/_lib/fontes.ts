// Fontes (D10: só acesso público) e suas evidências. Fonte nasce inativa; só ativa com termos revisados.
import { asc, eq, inArray } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { HttpError, json, newId, readBody, type RouteFn } from './http';
import { EvidenceCreate, SourceCreate, SourcePatch } from './schemas';

async function withEditorias(db: Db, rows: (typeof schema.sources.$inferSelect)[]) {
  if (!rows.length) return [];
  const links = await db.select().from(schema.sourceEditorias).where(inArray(schema.sourceEditorias.sourceId, rows.map((r) => r.id)));
  return rows.map((r) => ({ ...r, editorias: links.filter((l) => l.sourceId === r.id).map((l) => l.editoria).sort() }));
}

async function assertEditorias(db: Db, slugs: readonly string[]) {
  const found = await db.select({ slug: schema.editorias.slug }).from(schema.editorias).where(inArray(schema.editorias.slug, [...slugs]));
  const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
  if (missing.length) throw new HttpError(422, 'UNKNOWN_EDITORIA', 'Editoria inexistente.', { slugs: missing });
}

async function loadSource(db: Db, id: string) {
  const [s] = await db.select().from(schema.sources).where(eq(schema.sources.id, id));
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Fonte não encontrada.');
  return s;
}

export const listSources: RouteFn = async (_req, c) =>
  json({ data: await withEditorias(c.deps.db, await c.deps.db.select().from(schema.sources).orderBy(asc(schema.sources.nome))) });

export const getSource: RouteFn = async (_req, c) => {
  const s = await loadSource(c.deps.db, c.params.id ?? '');
  return json({ data: (await withEditorias(c.deps.db, [s]))[0] });
};

export const createSource: RouteFn = async (req, c) => {
  const b = await readBody(req, SourceCreate);
  const eds = [...new Set(b.editorias)];
  await assertEditorias(c.deps.db, eds);
  await c.deps.db.transaction(async (tx) => {
    await tx.insert(schema.sources).values({
      id: b.id,
      nome: b.nome,
      url: b.url,
      tipo: b.tipo,
      acesso: b.acesso,
      termosRevisados: b.termosRevisados,
      ativo: false,
    });
    await tx.insert(schema.sourceEditorias).values(eds.map((editoria) => ({ sourceId: b.id, editoria })));
  });
  return json({ data: (await withEditorias(c.deps.db, [await loadSource(c.deps.db, b.id)]))[0] }, 201);
};

export const patchSource: RouteFn = async (req, c) => {
  const b = await readBody(req, SourcePatch);
  const cur = await loadSource(c.deps.db, c.params.id ?? '');
  const termos = b.termosRevisados ?? cur.termosRevisados;
  const ativo = b.ativo ?? cur.ativo;
  if (ativo && !termos) throw new HttpError(409, 'TERMS_NOT_REVIEWED', 'Fonte só é ativada com os termos de uso revisados.');
  const eds = b.editorias ? [...new Set(b.editorias)] : null;
  if (eds) await assertEditorias(c.deps.db, eds);
  const fields = { ...b };
  delete fields.editorias;
  await c.deps.db.transaction(async (tx) => {
    if (Object.keys(fields).length) await tx.update(schema.sources).set(fields).where(eq(schema.sources.id, cur.id));
    if (eds) {
      await tx.delete(schema.sourceEditorias).where(eq(schema.sourceEditorias.sourceId, cur.id));
      await tx.insert(schema.sourceEditorias).values(eds.map((editoria) => ({ sourceId: cur.id, editoria })));
    }
  });
  return json({ data: (await withEditorias(c.deps.db, [await loadSource(c.deps.db, cur.id)]))[0] });
};

export const deleteSource: RouteFn = async (_req, c) => {
  const deleted = await c.deps.db.delete(schema.sources).where(eq(schema.sources.id, c.params.id ?? '')).returning();
  if (!deleted[0]) throw new HttpError(404, 'NOT_FOUND', 'Fonte não encontrada.');
  return new Response(null, { status: 204 });
};

export const listEvidences: RouteFn = async (_req, c) => {
  await loadSource(c.deps.db, c.params.id ?? '');
  return json({
    data: await c.deps.db.select().from(schema.evidences).where(eq(schema.evidences.sourceId, c.params.id ?? '')).orderBy(asc(schema.evidences.capturadoEm)),
  });
};

export const createEvidence: RouteFn = async (req, c) => {
  const b = await readBody(req, EvidenceCreate);
  const s = await loadSource(c.deps.db, c.params.id ?? '');
  if (!s.ativo) throw new HttpError(409, 'SOURCE_INACTIVE', 'Evidência só de fonte ativa.');
  const [e] = await c.deps.db
    .insert(schema.evidences)
    .values({ id: newId(), sourceId: s.id, url: b.url, capturadoEm: new Date(b.capturadoEm), sha256: b.sha256 })
    .returning();
  return json({ data: e }, 201);
};
