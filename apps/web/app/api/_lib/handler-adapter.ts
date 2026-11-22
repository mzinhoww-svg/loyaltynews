// Adaptador genérico handler → rota. Os módulos de domínio (Comercial, Intelligence, Growth, Editorial) publicam uma
// tabela de rotas com handlers puros `(ctx, entradaNãoValidada) => { status, body }`. Aqui ficam o roteamento por
// método e caminho, a extração da entrada (query string vira objeto no GET; JSON no POST), a autenticação por rota
// (`public` | `studio`), o limite de formulários públicos, a auditoria e a tradução para Response.
// O que é do módulo (montar o ctx do domínio, persistir) entra por `call`.
import { z } from 'zod';
import { acquireAttempt, type Action, type Resource } from '@ln/auth';
import { execute, HttpError, json, queryObject, readBody, type RouteCtx, type RouteFn } from './http';

export interface HttpResult {
  status: number;
  body: unknown;
}

export interface PureRoute<H = unknown> {
  method: 'GET' | 'POST';
  /** Caminho com segmentos `:nome` opcionais; os valores entram na entrada do handler (e vencem o que o cliente enviar). */
  path: string;
  auth: 'public' | 'studio';
  /** Permissão desta rota (substitui `studioPerm`). */
  perm?: readonly [Resource, Action];
  handler: H;
}

export interface DispatcherOptions<H> {
  routes: readonly PureRoute<H>[];
  /** Permissão exigida (sessão + MFA + RBAC) nas rotas `studio`; o handler ainda aplica as próprias regras. */
  studioPerm: readonly [Resource, Action];
  /** Hidrata o contexto do módulo, executa o handler e persiste. Recebe a entrada ainda não validada. */
  call: (route: PureRoute<H>, input: unknown, c: RouteCtx) => Promise<HttpResult>;
  /** Auditoria das rotas POST de Studio. */
  auditResource: string;
  /** Limite por IP (5 por 15 min) nos POST públicos, contra spam de formulário. Só vale com IP de proxy confiável. */
  limitPublicPosts?: boolean;
}

const norm = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

/** Casa `/a/:id/b` com `/a/123/b` e devolve os parâmetros (decodificados), ou null. */
export function matchPath(template: string, path: string): Record<string, string> | null {
  const t = template.split('/');
  const p = path.split('/');
  if (t.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i++) {
    const seg = t[i]!;
    if (seg.startsWith(':')) {
      let v: string;
      try { v = decodeURIComponent(p[i]!); } catch { return null; }
      if (!v) return null;
      params[seg.slice(1)] = v;
    } else if (seg !== p[i]) return null;
  }
  return params;
}

export function createDispatcher<H>(opts: DispatcherOptions<H>) {
  return async function dispatch(req: Request): Promise<Response> {
    const path = norm(new URL(req.url).pathname);
    const method = req.method.toUpperCase();
    let params: Record<string, string> = {};
    const route = opts.routes.find((r) => {
      const m = r.method === method ? matchPath(r.path, path) : null;
      if (m) params = m;
      return m !== null;
    });
    if (!route) {
      const known = opts.routes.some((r) => matchPath(r.path, path) !== null);
      return execute(req, 'public', async () => {
        throw known ? new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.') : new HttpError(404, 'NOT_FOUND', 'Rota inexistente.');
      });
    }
    const fn: RouteFn = async (r, c) => {
      if (route.auth === 'public' && method === 'POST' && opts.limitPublicPosts && c.ip) {
        const gate = await acquireAttempt(c.deps.db, 'form', `${opts.auditResource}:${c.ip}`, c.deps.now());
        if (!gate.allowed) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Muitas requisições. Tente novamente mais tarde.');
      }
      const raw = method === 'GET' ? queryObject(c.url) : await readBody(r, z.unknown());
      const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const result = await opts.call(route, { ...base, ...params }, c);
      return json(result.body, result.status);
    };
    return execute(req, route.auth === 'public' ? 'public' : (route.perm ?? opts.studioPerm), fn, {}, route.auth === 'studio' && method === 'POST'
      ? { audit: { action: `${opts.auditResource}.${route.path.split('/').filter((x) => x && !x.startsWith(':')).slice(-2).join('.')}`, resource: opts.auditResource } }
      : {});
  };
}
