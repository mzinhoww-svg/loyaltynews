// Editorias: as dez do Blueprint 2.1 (D13) — o slug é fechado em @ln/contracts. A API cadastra uma
// editoria do conjunto oficial (idempotente), renomeia e exclui (só sem matérias).
import { asc, eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import { EDITORIAS } from '@ln/contracts';
import { HttpError, json, readBody, type RouteFn } from './http';
import { EditoriaCreate, EditoriaPatch } from './schemas';

export const listEditorias: RouteFn = async (_req, c) =>
  json({ data: await c.deps.db.select().from(schema.editorias).orderBy(asc(schema.editorias.nome)) });

export const getEditoria: RouteFn = async (_req, c) => {
  const [e] = await c.deps.db.select().from(schema.editorias).where(eq(schema.editorias.slug, c.params.slug ?? ''));
  if (!e) throw new HttpError(404, 'NOT_FOUND', 'Editoria não encontrada.');
  return json({ data: e });
};

/** Cadastra uma das dez editorias oficiais com o nome oficial. Repetir devolve 200 sem alterar. */
export const createEditoria: RouteFn = async (req, c) => {
  const { slug } = await readBody(req, EditoriaCreate);
  const nome = EDITORIAS.find((e) => e.slug === slug)?.nome ?? slug;
  const [created] = await c.deps.db.insert(schema.editorias).values({ slug, nome }).onConflictDoNothing().returning();
  if (created) return json({ data: created }, 201);
  const [existing] = await c.deps.db.select().from(schema.editorias).where(eq(schema.editorias.slug, slug));
  return json({ data: existing }, 200);
};

export const patchEditoria: RouteFn = async (req, c) => {
  const b = await readBody(req, EditoriaPatch);
  const [e] = await c.deps.db.update(schema.editorias).set({ nome: b.nome }).where(eq(schema.editorias.slug, c.params.slug ?? '')).returning();
  if (!e) throw new HttpError(404, 'NOT_FOUND', 'Editoria não encontrada.');
  return json({ data: e });
};

export const deleteEditoria: RouteFn = async (_req, c) => {
  const slug = c.params.slug ?? '';
  const [used] = await c.deps.db.select({ id: schema.articles.id }).from(schema.articles).where(eq(schema.articles.editoria, slug)).limit(1);
  if (used) throw new HttpError(409, 'IN_USE', 'Editoria com matérias não pode ser excluída.');
  const deleted = await c.deps.db.delete(schema.editorias).where(eq(schema.editorias.slug, slug)).returning();
  if (!deleted[0]) throw new HttpError(404, 'NOT_FOUND', 'Editoria não encontrada.');
  return new Response(null, { status: 204 });
};

export const publicListEditorias: RouteFn = async (_req, c) =>
  json({ data: await c.deps.db.select().from(schema.editorias).orderBy(asc(schema.editorias.nome)) }, 200, {
    'cache-control': 'public, max-age=300',
  });
