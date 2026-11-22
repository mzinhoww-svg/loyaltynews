// Biblioteca de mídia: metadados + base de direito (o arquivo vive no Blob S3 compatível; upload ainda não ligado).
import { count, desc, eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import { isImagePublishable, type ImageRights } from '@ln/contracts';
import { HttpError, json, newId, parse, Paging, queryObject, readBody, type RouteFn } from './http';
import { MediaCreate, MediaQuery } from './schemas';

const view = (m: typeof schema.media.$inferSelect) => ({ ...m, publicavel: isImagePublishable(m.direitos as ImageRights) });

export const listMedia: RouteFn = async (_req, c) => {
  const q = parse(MediaQuery.extend(Paging.shape), queryObject(c.url));
  const where = q.tipo ? eq(schema.media.tipo, q.tipo) : undefined;
  const rows = await c.deps.db.select().from(schema.media).where(where).orderBy(desc(schema.media.criadoEm)).limit(q.limit).offset(q.offset);
  const [total] = await c.deps.db.select({ n: count() }).from(schema.media).where(where);
  return json({ data: rows.map(view), total: total?.n ?? 0, limit: q.limit, offset: q.offset });
};

export const getMedia: RouteFn = async (_req, c) => {
  const [m] = await c.deps.db.select().from(schema.media).where(eq(schema.media.id, c.params.id ?? ''));
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'Mídia não encontrada.');
  return json({ data: view(m) });
};

export const createMedia: RouteFn = async (req, c) => {
  const b = await readBody(req, MediaCreate);
  const [m] = await c.deps.db
    .insert(schema.media)
    .values({ id: newId(), tipo: b.tipo, direitos: b.direitos, sha256: b.sha256, criadoEm: c.deps.now() })
    .returning();
  return json({ data: view(m!) }, 201);
};

export const deleteMedia: RouteFn = async (_req, c) => {
  const d = await c.deps.db.delete(schema.media).where(eq(schema.media.id, c.params.id ?? '')).returning();
  if (!d[0]) throw new HttpError(404, 'NOT_FOUND', 'Mídia não encontrada.');
  return new Response(null, { status: 204 });
};
