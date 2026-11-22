// Agenda de eventos. Evento patrocinado é sinalizado (`patrocinado`) para o Portal rotular (F-074).
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { schema } from '@ln/db';
import { HttpError, json, newId, parse, queryObject, readBody, type RouteFn } from './http';
import { AgendaCreate, AgendaPatch, AgendaQuery } from './schemas';

const range = (q: { from?: string; to?: string }) =>
  and(q.from ? gte(schema.agendaEvents.fim, q.from) : undefined, q.to ? lte(schema.agendaEvents.inicio, q.to) : undefined);

const order = [asc(schema.agendaEvents.inicio), asc(schema.agendaEvents.id)] as const;

export const listAgenda: RouteFn = async (_req, c) => {
  const q = parse(AgendaQuery, queryObject(c.url));
  return json({ data: await c.deps.db.select().from(schema.agendaEvents).where(range(q)).orderBy(...order) });
};

/** Público: eventos que ainda não terminaram (ou no intervalo pedido). */
export const publicListAgenda: RouteFn = async (_req, c) => {
  const q = parse(AgendaQuery, queryObject(c.url));
  const from = q.from ?? c.deps.now().toISOString().slice(0, 10);
  const rows = await c.deps.db.select().from(schema.agendaEvents).where(range({ from, to: q.to })).orderBy(...order);
  return json({ data: rows }, 200, { 'cache-control': 'public, max-age=300' });
};

export const getAgenda: RouteFn = async (_req, c) => {
  const [e] = await c.deps.db.select().from(schema.agendaEvents).where(eq(schema.agendaEvents.id, c.params.id ?? ''));
  if (!e) throw new HttpError(404, 'NOT_FOUND', 'Evento não encontrado.');
  return json({ data: e });
};

export const createAgenda: RouteFn = async (req, c) => {
  const b = await readBody(req, AgendaCreate);
  const [e] = await c.deps.db
    .insert(schema.agendaEvents)
    .values({ id: newId(), ...b, url: b.url ?? null })
    .returning();
  return json({ data: e }, 201);
};

export const patchAgenda: RouteFn = async (req, c) => {
  const b = await readBody(req, AgendaPatch);
  const [cur] = await c.deps.db.select().from(schema.agendaEvents).where(eq(schema.agendaEvents.id, c.params.id ?? ''));
  if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Evento não encontrado.');
  if ((b.fim ?? cur.fim) < (b.inicio ?? cur.inicio)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Fim anterior ao início.', [{ path: 'fim', message: 'fim anterior ao início' }]);
  }
  const [e] = await c.deps.db.update(schema.agendaEvents).set(b).where(eq(schema.agendaEvents.id, cur.id)).returning();
  return json({ data: e });
};

export const deleteAgenda: RouteFn = async (_req, c) => {
  const d = await c.deps.db.delete(schema.agendaEvents).where(eq(schema.agendaEvents.id, c.params.id ?? '')).returning();
  if (!d[0]) throw new HttpError(404, 'NOT_FOUND', 'Evento não encontrado.');
  return new Response(null, { status: 204 });
};
