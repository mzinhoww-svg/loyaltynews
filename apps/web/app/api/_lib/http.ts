// Adaptador genérico handler → rota Next. Autoriza (sessão + MFA + RBAC), valida entrada com zod,
// traduz erros de domínio e do banco para o envelope ApiError e audita escritas.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { apiError } from '@ln/contracts';
import { AccessDeniedError, audit, authorize, clientIp, type Action, type Resource, type FullSession } from '@ln/auth';
import { getDeps, type Deps } from './deps';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface RouteCtx {
  deps: Deps;
  params: Record<string, string>;
  url: URL;
  /** null só em rotas públicas sem login. */
  session: FullSession | null;
  ip: string | null;
  requestId: string;
}

export type Perm = 'public' | readonly [Resource, Action];
export type RouteFn = (req: Request, c: RouteCtx) => Promise<Response>;
type NextParams = { params?: Promise<Record<string, string>> };

const MAX_BODY = 1_000_000;

export const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });

/** Lê e valida o corpo JSON (até 1 MB). */
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo acima de 1 MB.');
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Corpo JSON inválido.');
  }
  return parse(schema, raw);
}

export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Entrada inválida.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

/** Query string → objeto (valor repetido vira array). */
export function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

function dbCode(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.cause?.code ?? x?.code;
}

export function toResponse(e: unknown, requestId: string): Response {
  const h = { 'x-request-id': requestId };
  const env = (status: number, code: string, message: string, details?: unknown) => {
    const body = apiError(code, message, details);
    return json({ error: { ...body.error, requestId } }, status, h);
  };
  if (e instanceof HttpError) return env(e.status, e.code, e.message, e.details);
  if (e instanceof AccessDeniedError) {
    if (e.reason === 'NO_SESSION') return env(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
    if (e.reason === 'NO_MFA') return env(403, 'MFA_REQUIRED', 'Segundo fator (TOTP) obrigatório.');
    return env(403, 'FORBIDDEN', 'Sem permissão para esta ação.');
  }
  const c = dbCode(e);
  if (c === '23505') return env(409, 'CONFLICT', 'Registro já existe.');
  if (c === '23503') return env(409, 'REFERENCE_CONFLICT', 'Registro referenciado por outro ou referência inexistente.');
  if (c === '23514' || c === '23502' || c === '22P02') return env(422, 'CONSTRAINT_VIOLATION', 'Dado viola uma regra do banco.');
  if (c === '23000') return env(409, 'IMMUTABLE', 'Registro imutável.');
  console.error(`[api ${requestId}]`, e instanceof Error ? e.name : 'erro', c ?? ''); // sem corpo, sem segredo
  return env(500, 'INTERNAL_ERROR', 'Erro interno.');
}

/** Executa um handler com sessão/RBAC, contexto, auditoria opcional e tradução de erros. */
export async function execute(
  req: Request,
  perm: Perm,
  fn: RouteFn,
  params: Record<string, string> = {},
  opts: { audit?: { action: string; resource: string } } = {},
): Promise<Response> {
  const requestId = req.headers.get('x-request-id') ?? randomUUID();
  try {
    const deps = getDeps();
    if (!deps) throw new HttpError(503, 'NOT_CONFIGURED', 'Banco não configurado neste ambiente.');
    const session = perm === 'public' ? null : await authorize(deps.auth, req.headers, perm[0], perm[1]);
    const ctx: RouteCtx = { deps, params, url: new URL(req.url), session, ip: clientIp(req.headers), requestId };
    const res = await fn(req, ctx);
    if (opts.audit && res.status < 400) {
      await audit(deps.db, {
        actorId: session?.userId,
        actorRole: session?.role,
        action: opts.audit.action,
        resource: opts.audit.resource,
        resourceId: params.id ?? params.slug ?? null,
        ip: ctx.ip,
        detalhe: { requestId, status: res.status },
        at: deps.now(),
      });
    }
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (e) {
    return toResponse(e, requestId);
  }
}

/** Monta a função de rota do Next a partir de um handler e da permissão exigida. */
export function route(perm: Perm, fn: RouteFn, opts: { audit?: { action: string; resource: string } } = {}) {
  return async (req: Request, next?: NextParams): Promise<Response> => execute(req, perm, fn, (await next?.params) ?? {}, opts);
}

export const newId = () => randomUUID();

/** Paginação: limit (1–100, padrão 20) e offset. */
export const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
