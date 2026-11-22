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
  path: string;
  auth: 'public' | 'studio';
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

export function createDispatcher<H>(opts: DispatcherOptions<H>) {
  return async function dispatch(req: Request): Promise<Response> {
    const path = norm(new URL(req.url).pathname);
    const method = req.method.toUpperCase();
    const route = opts.routes.find((r) => r.method === method && r.path === path);
    if (!route) {
      const known = opts.routes.some((r) => r.path === path);
      return execute(req, 'public', async () => {
        throw known ? new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.') : new HttpError(404, 'NOT_FOUND', 'Rota inexistente.');
      });
    }
    const fn: RouteFn = async (r, c) => {
      if (route.auth === 'public' && method === 'POST' && opts.limitPublicPosts && c.ip) {
        const gate = await acquireAttempt(c.deps.db, 'form', `${opts.auditResource}:${c.ip}`, c.deps.now());
        if (!gate.allowed) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Muitas requisições. Tente novamente mais tarde.');
      }
      const input = method === 'GET' ? queryObject(c.url) : await readBody(r, z.unknown());
      const result = await opts.call(route, input ?? {}, c);
      return json(result.body, result.status);
    };
    return execute(req, route.auth === 'public' ? 'public' : opts.studioPerm, fn, {}, route.auth === 'studio' && method === 'POST'
      ? { audit: { action: `${opts.auditResource}.${route.path.split('/').slice(-2).join('.')}`, resource: opts.auditResource } }
      : {});
  };
}
