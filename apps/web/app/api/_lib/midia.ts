// Biblioteca de mídia: metadados, base de direito, EVIDÊNCIA e EXPIRAÇÃO da licença, deduplicação por sha256 e
// upload do arquivo (Blob S3 compatível). Regras:
//  - licença/autorização/exceção validada exigem evidência; expiração no passado é recusada ao registrar;
//  - mídia com licença vencida ou base de direito pendente não é publicável (publicavel=false);
//  - um registro por conteúdo (sha256 único): repetir devolve o existente (deduplicada=true);
//  - upload: o sha256 e o tipo vêm do CONTEÚDO (assinatura do arquivo), nunca do cliente; SVG e outros tipos são recusados.
import { createHash } from 'node:crypto';
import { and, count, desc, eq, gte, inArray, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@ln/db';
import { type ImageRights, isImagePublishable } from '@ln/contracts';
import type { Db } from '@ln/auth';
import { getBlobStore, type BlobStore } from './blob';
import { HttpError, json, newId, parse, Paging, queryObject, readBody, type RouteCtx, type RouteFn } from './http';
import { MediaCreate, MediaPatch, MediaQuery, SafeImage, UploadMeta } from './schemas';

type Row = typeof schema.media.$inferSelect;
export const MAX_IMAGEM_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTO_BYTES = 10 * 1024 * 1024;
const EVIDENCE_REQUIRED = new Set(['licenca', 'autorizacao', 'excecao_validada']);
const VENCE_EM_BREVE_DIAS = 30;

/** Data de calendário em America/Sao_Paulo (AAAA-MM-DD). */
export const hoje = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type LicencaStatus = 'sem_expiracao' | 'valida' | 'vence_em_breve' | 'vencida';
export function licencaStatus(expira: string | null, today: string): LicencaStatus {
  if (!expira) return 'sem_expiracao';
  if (expira < today) return 'vencida';
  return expira <= addDays(today, VENCE_EM_BREVE_DIAS) ? 'vence_em_breve' : 'valida';
}

/** Tipo e MIME pela assinatura do arquivo (magic bytes). SVG, HTML e demais formatos ativos ficam de fora. */
export function sniff(b: Uint8Array): { mime: string; tipo: 'imagem' | 'documento' } | null {
  const at = (off: number, s: string) => [...s].every((ch, i) => b[off + i] === ch.charCodeAt(0));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', tipo: 'imagem' };
  if (b.length >= 8 && b[0] === 0x89 && at(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', tipo: 'imagem' };
  if (b.length >= 6 && (at(0, 'GIF87a') || at(0, 'GIF89a'))) return { mime: 'image/gif', tipo: 'imagem' };
  if (b.length >= 12 && at(0, 'RIFF') && at(8, 'WEBP')) return { mime: 'image/webp', tipo: 'imagem' };
  if (b.length >= 5 && at(0, '%PDF-')) return { mime: 'application/pdf', tipo: 'documento' };
  return null;
}

const view = (m: Row, today: string) => {
  const status = licencaStatus(m.licencaExpiraEm, today);
  const { blobKey, ...rest } = m;
  return {
    ...rest,
    temArquivo: blobKey !== null,
    licencaStatus: status,
    publicavel: isImagePublishable(m.direitos as ImageRights) && status !== 'vencida',
  };
};

function assertLicenca(direitos: { baseDeDireito: string }, evidencia: unknown, expira: string | null | undefined, today: string, criando: boolean) {
  if (EVIDENCE_REQUIRED.has(direitos.baseDeDireito) && !evidencia) {
    throw new HttpError(422, 'LICENSE_EVIDENCE_REQUIRED', `Base de direito "${direitos.baseDeDireito}" exige evidência da licença.`);
  }
  if (criando && expira && expira < today) {
    throw new HttpError(422, 'LICENSE_EXPIRED', 'A licença informada já está vencida.');
  }
}

export const listMedia: RouteFn = async (_req, c) => {
  const q = parse(MediaQuery.extend(Paging.shape), queryObject(c.url));
  const today = hoje(c.deps.now());
  const conds: (SQL | undefined)[] = [q.tipo ? eq(schema.media.tipo, q.tipo) : undefined];
  if (q.vencida === 'true') conds.push(lt(schema.media.licencaExpiraEm, today));
  if (q.vencendo) conds.push(and(gte(schema.media.licencaExpiraEm, today), lte(schema.media.licencaExpiraEm, addDays(today, q.vencendo))));
  const where = and(...conds);
  const rows = await c.deps.db.select().from(schema.media).where(where).orderBy(desc(schema.media.criadoEm), schema.media.id).limit(q.limit).offset(q.offset);
  const [total] = await c.deps.db.select({ n: count() }).from(schema.media).where(where);
  return json({ data: rows.map((r) => view(r, today)), total: total?.n ?? 0, limit: q.limit, offset: q.offset });
};

async function load(c: RouteCtx, id: string): Promise<Row> {
  const [m] = await c.deps.db.select().from(schema.media).where(eq(schema.media.id, id));
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'Mídia não encontrada.');
  return m;
}

export const getMedia: RouteFn = async (_req, c) => json({ data: view(await load(c, c.params.id ?? ''), hoje(c.deps.now())) });

/** Registro só de metadados (o arquivo, se houver, vem por /api/midia/arquivo). Repetir o mesmo sha256 devolve o existente. */
export const createMedia: RouteFn = async (req, c) => {
  const b = await readBody(req, MediaCreate);
  const today = hoje(c.deps.now());
  assertLicenca(b.direitos, b.licencaEvidencia, b.licencaExpiraEm, today, true);
  const [dup] = await c.deps.db.select().from(schema.media).where(eq(schema.media.sha256, b.sha256));
  if (dup) return json({ data: view(dup, today), deduplicada: true }, 200);
  const [m] = await c.deps.db
    .insert(schema.media)
    .values({
      id: newId(), tipo: b.tipo, direitos: b.direitos, sha256: b.sha256, licencaExpiraEm: b.licencaExpiraEm ?? null,
      licencaEvidencia: b.licencaEvidencia ?? null, criadoEm: c.deps.now(),
    })
    .onConflictDoNothing({ target: schema.media.sha256 })
    .returning();
  if (!m) {
    const [again] = await c.deps.db.select().from(schema.media).where(eq(schema.media.sha256, b.sha256));
    return json({ data: view(again!, today), deduplicada: true }, 200);
  }
  return json({ data: view(m, today), deduplicada: false }, 201);
};

export const patchMedia: RouteFn = async (req, c) => {
  const b = await readBody(req, MediaPatch);
  const cur = await load(c, c.params.id ?? '');
  const today = hoje(c.deps.now());
  const direitos = b.direitos ?? (cur.direitos as { baseDeDireito: string });
  const evidencia = b.licencaEvidencia === undefined ? cur.licencaEvidencia : b.licencaEvidencia;
  const expira = b.licencaExpiraEm === undefined ? cur.licencaExpiraEm : b.licencaExpiraEm;
  assertLicenca(direitos, evidencia, expira, today, false);
  const set: Partial<typeof schema.media.$inferInsert> = {};
  if (b.direitos) set.direitos = b.direitos;
  if (b.licencaExpiraEm !== undefined) set.licencaExpiraEm = b.licencaExpiraEm;
  if (b.licencaEvidencia !== undefined) set.licencaEvidencia = b.licencaEvidencia;
  const [m] = await c.deps.db.update(schema.media).set(set).where(eq(schema.media.id, cur.id)).returning();
  return json({ data: view(m!, today) });
};

export const deleteMedia: RouteFn = async (_req, c) => {
  const cur = await load(c, c.params.id ?? '');
  await c.deps.db.delete(schema.media).where(eq(schema.media.id, cur.id));
  if (cur.blobKey) {
    const blob = c.deps.blob === undefined ? getBlobStore() : c.deps.blob;
    await blob?.delete(cur.blobKey).catch(() => undefined); // órfão no Blob é inofensivo; o registro já saiu
  }
  return new Response(null, { status: 204 });
};

function blobOf(c: RouteCtx): BlobStore {
  const blob = c.deps.blob === undefined ? getBlobStore() : c.deps.blob;
  if (!blob) throw new HttpError(503, 'NOT_CONFIGURED', 'Armazenamento de arquivos não configurado neste ambiente.');
  return blob;
}

/** multipart/form-data: `arquivo` (File) + `metadados` (JSON: direitos, licencaExpiraEm?, licencaEvidencia?). */
export const uploadMedia: RouteFn = async (req, c) => {
  const blob = blobOf(c);
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_DOCUMENTO_BYTES + 200_000) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Arquivo acima do limite.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'INVALID_MULTIPART', 'Envie multipart/form-data com os campos arquivo e metadados.');
  }
  const file = form.get('arquivo');
  if (!(file instanceof File)) throw new HttpError(400, 'VALIDATION_ERROR', 'Campo arquivo ausente.', [{ path: 'arquivo', message: 'obrigatório' }]);
  let rawMeta: unknown;
  try {
    rawMeta = JSON.parse(String(form.get('metadados') ?? '{}'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'metadados não é JSON válido.');
  }
  const meta = parse(UploadMeta, rawMeta);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de arquivo não aceito (JPEG, PNG, GIF, WebP ou PDF).');
  const max = kind.tipo === 'imagem' ? MAX_IMAGEM_BYTES : MAX_DOCUMENTO_BYTES;
  if (bytes.length === 0 || bytes.length > max) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Arquivo fora do limite (${max} bytes).`);

  const today = hoje(c.deps.now());
  assertLicenca(meta.direitos, meta.licencaEvidencia, meta.licencaExpiraEm, today, true);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const [dup] = await c.deps.db.select().from(schema.media).where(eq(schema.media.sha256, sha256));
  const key = `midia/${sha256}`;

  if (dup) {
    if (dup.blobKey) return json({ data: view(dup, today), deduplicada: true }, 200);
    // registro só de metadados com o mesmo conteúdo: anexa o arquivo
    await blob.put(key, bytes, kind.mime);
    const [m] = await c.deps.db.update(schema.media).set({ blobKey: key, mime: kind.mime, bytes: bytes.length }).where(eq(schema.media.id, dup.id)).returning();
    return json({ data: view(m!, today), deduplicada: true, arquivoAnexado: true }, 200);
  }

  const id = newId();
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const direitos = SafeImage.parse({ ...meta.direitos, url: `${site}/api/midia/${id}/arquivo` });
  await blob.put(key, bytes, kind.mime); // conteúdo endereçado por sha256: repetir o put é inofensivo
  const [m] = await c.deps.db
    .insert(schema.media)
    .values({
      id, tipo: kind.tipo, direitos, sha256, blobKey: key, mime: kind.mime, bytes: bytes.length,
      licencaExpiraEm: meta.licencaExpiraEm ?? null, licencaEvidencia: meta.licencaEvidencia ?? null, criadoEm: c.deps.now(),
    })
    .onConflictDoNothing({ target: schema.media.sha256 })
    .returning();
  if (!m) {
    const [again] = await c.deps.db.select().from(schema.media).where(eq(schema.media.sha256, sha256));
    return json({ data: view(again!, today), deduplicada: true }, 200);
  }
  return json({ data: view(m, today), deduplicada: false }, 201);
};

/** Bytes do arquivo para o Studio (prévia). Cabeçalhos defensivos: nada é executado nem interpretado pelo navegador. */
export const getMediaFile: RouteFn = async (_req, c) => {
  const m = await load(c, c.params.id ?? '');
  if (!m.blobKey || !m.mime) throw new HttpError(404, 'NO_FILE', 'Este registro não tem arquivo.');
  const obj = await blobOf(c).get(m.blobKey);
  if (!obj) throw new HttpError(404, 'NO_FILE', 'Arquivo não encontrado no armazenamento.');
  return new Response(obj.bytes as BodyInit, {
    status: 200,
    headers: {
      'content-type': m.mime,
      'content-length': String(obj.bytes.length),
      'content-disposition': m.mime === 'application/pdf' ? `attachment; filename="midia-${m.id}.pdf"` : 'inline',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=300',
    },
  });
};

// ---------- entrega PÚBLICA (Portal): só mídia referenciada por matéria publicada ----------
const MEDIA_ID = /^[A-Za-z0-9-]{1,64}$/;
const INTERNAL_URL = /\/api\/midia\/([A-Za-z0-9-]{1,64})\/arquivo$/;
const PUBLIC_STATUS = ['publicado', 'corrigido'] as const;

/** Imagem de mídia que pode sair a um leitor anônimo: imagem com arquivo, base de direito válida e licença não vencida. */
const publicMedia = (m: Row, today: string): boolean =>
  m.tipo === 'imagem' && !!m.blobKey && !!m.mime?.startsWith('image/') && isImagePublishable(m.direitos as ImageRights) && licencaStatus(m.licencaExpiraEm, today) !== 'vencida';

/** A matéria PÚBLICA (publicado/corrigido, classe public) cita esta mídia em `imagem.url`? */
async function referencedByPublicArticle(db: Db, id: string): Promise<boolean> {
  const url = sql`${schema.articles.imagem}->>'url'`;
  const [a] = await db
    .select({ id: schema.articles.id })
    .from(schema.articles)
    .where(and(inArray(schema.articles.status, [...PUBLIC_STATUS]), eq(schema.articles.classeDeDado, 'public'), or(like(url, `%/api/midia/${id}/arquivo`), like(url, `%/api/publico/midia/${id}`))))
    .limit(1);
  return !!a;
}

/**
 * Imagem da matéria para a resposta pública: URL de mídia interna (`/api/midia/{id}/arquivo`, que exige sessão) passa a apontar
 * para a entrega pública; mídia inexistente, sem arquivo, com licença vencida ou sem base de direito ⇒ sem imagem (null).
 * URL que não é do acervo (imagem externa) segue como está.
 */
export async function publicImageOf(db: Db, img: unknown, now: Date): Promise<unknown> {
  if (img == null || typeof img !== 'object') return img ?? null;
  const url = (img as { url?: unknown }).url;
  const m = typeof url === 'string' ? INTERNAL_URL.exec(url) : null;
  if (!m) return img;
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, m[1]!));
  if (!row || !publicMedia(row, hoje(now))) return null;
  return { ...(img as object), url: (url as string).replace(INTERNAL_URL, '/api/publico/midia/$1') };
}

/**
 * GET /api/publico/midia/{id} (sem login): os bytes de uma imagem do acervo, SOMENTE se uma matéria publicada/corrigida a cita.
 * Não lista o acervo; rascunho, mídia órfã, documento, sem base de direito ou com licença vencida respondem o MESMO 404.
 * Cabeçalhos defensivos (nosniff, CSP sandbox), cache público curto e ETag pelo sha256 (304 em If-None-Match).
 */
export const getPublicMediaFile: RouteFn = async (req, c) => {
  const id = c.params.id ?? '';
  const nao = () => new HttpError(404, 'NOT_FOUND', 'Mídia não encontrada.');
  if (!MEDIA_ID.test(id)) throw nao();
  const [m] = await c.deps.db.select().from(schema.media).where(eq(schema.media.id, id));
  if (!m || !publicMedia(m, hoje(c.deps.now())) || !(await referencedByPublicArticle(c.deps.db, id))) throw nao();
  const headers = {
    etag: `"${m.sha256}"`,
    'cache-control': 'public, max-age=300, stale-while-revalidate=60',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'cross-origin',
  };
  if (req.headers.get('if-none-match') === `"${m.sha256}"`) return new Response(null, { status: 304, headers });
  const obj = await blobOf(c).get(m.blobKey!);
  if (!obj) throw nao();
  return new Response(obj.bytes as BodyInit, { status: 200, headers: { ...headers, 'content-type': m.mime!, 'content-length': String(obj.bytes.length), 'content-disposition': 'inline' } });
};
