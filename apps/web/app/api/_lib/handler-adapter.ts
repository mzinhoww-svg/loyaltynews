// Adaptador genérico handler → rota. Os módulos de domínio (Comercial, Intelligence, Growth, Editorial) publicam uma
// tabela de rotas com handlers puros `(ctx, entradaNãoValidada) => { status, body }`. Aqui ficam o roteamento por
// método e caminho, a extração da entrada (query string vira objeto no GET; JSON no POST), a autenticação por rota
// (`public` | `studio`), o limite de formulários públicos, a auditoria e a tradução para Response.
// O que é do módulo (montar o ctx do domínio, persistir) entra por `call`.
import { z } from 'zod';
import { MAX_FAILURES, WINDOW_MS, acquireAttempt, type Action, type Resource } from '@ln/auth';
import { execute, HttpError, json, queryObject, readBody, type RouteCtx, type RouteFn } from './http';

export interface HttpResult {
  status: number;
  body: unknown;
}

export interface PureRoute<H = unknown> {
  method: 'GET' | 'POST' | 'DELETE';
  /** Caminho com segmentos `:nome` opcionais; os valores entram na entrada do handler (e vencem o que o cliente enviar). */
  path: string;
  auth: 'public' | 'studio';
  /** Permissão desta rota (substitui `studioPerm`). */
  perm?: readonly [Resource, Action];
  handler: H;
}

/**
 * Envios aceitos por formulário e por janela de 15 min quando NÃO há IP de proxy confiável (TRUSTED_PROXY_HOPS ausente ou cabeçalho incompleto). Não distingue
 * visitantes: segura a enxurrada, mas quem a provoca também fecha o formulário para os outros por 15 min. Com o IP, vale o limite de 5 por IP.
 */
export const TETO_FORMULARIO_SEM_IP = 30;

export interface DispatcherOptions<H> {
  routes: readonly PureRoute<H>[];
  /** Permissão exigida (sessão + MFA + RBAC) nas rotas `studio`; o handler ainda aplica as próprias regras. */
  studioPerm: readonly [Resource, Action];
  /** Hidrata o contexto do módulo, executa o handler e persiste. Recebe a entrada ainda não validada. */
  call: (route: PureRoute<H>, input: unknown, c: RouteCtx) => Promise<HttpResult>;
  /** Auditoria das rotas POST de Studio. */
  auditResource: string;
  /**
   * Quais POST públicos são envio de FORMULÁRIO e têm limite, contra spam: 5 por 15 min por IP de proxy confiável; sem IP, TETO_FORMULARIO_SEM_IP no formulário.
   * Os demais POST públicos (ex.: anúncios, chamados a cada página) ficam fora: não são barrados nem gastam o limite do formulário.
   */
  limitedForm?: (route: PureRoute<H>) => boolean;
  /**
   * Rota fechada por flag de execução: devolve true quando a rota NÃO deve existir agora. Responde 404 "Rota inexistente" (igual a um
   * caminho que não existe), ANTES do limite por IP e de qualquer leitura do corpo: com a rota fechada nada é lido, gravado nem contado.
   */
  closed?: (route: PureRoute<H>) => boolean;
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
  // Aviso do teto sem IP: no máximo UM por formulário a cada 15 min em cada processo, com a contagem das recusas. Uma enxurrada não vira log sem fim.
  const avisos = new Map<string, { em: number; recusas: number }>(); // chave = caminho declarado da rota (conjunto fixo)
  const avisarTeto = (rota: string, agora: number) => {
    const a = avisos.get(rota) ?? { em: -Infinity, recusas: 0 };
    a.recusas += 1;
    if (agora - a.em >= WINDOW_MS) {
      // nada vindo de quem chamou entra na linha (nem o identificador da requisição)
      console.warn(`[api] teto sem IP atingido em ${rota} (recusas desde o aviso anterior: ${a.recusas})`);
      a.em = agora;
      a.recusas = 0;
    }
    avisos.set(rota, a);
  };
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
      if (opts.closed?.(route)) throw new HttpError(404, 'NOT_FOUND', 'Rota inexistente.');
      if (route.auth === 'public' && method === 'POST' && opts.limitedForm?.(route)) {
        // o sujeito vira HMAC dentro de acquireAttempt: nenhum IP é gravado em claro
        const sujeito = c.ip ? `${opts.auditResource}:${c.ip}` : `${opts.auditResource}:sem-ip:${route.path}`;
        const gate = await acquireAttempt(c.deps.db, 'form', sujeito, c.deps.now(), c.ip ? MAX_FAILURES : TETO_FORMULARIO_SEM_IP);
        if (!gate.allowed && !c.ip) avisarTeto(route.path, c.deps.now().getTime());
        if (!gate.allowed) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Muitas requisições. Tente novamente mais tarde.');
      }
      const raw = method === 'GET' ? queryObject(c.url) : await readBody(r, z.unknown());
      const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const result = await opts.call(route, { ...base, ...params }, c);
      return json(result.body, result.status);
    };
    return execute(req, route.auth === 'public' ? 'public' : (route.perm ?? opts.studioPerm), fn, {}, route.auth === 'studio' && method !== 'GET'
      ? { audit: { action: `${opts.auditResource}.${route.path.split('/').filter((x) => x && !x.startsWith(':')).slice(-2).join('.')}`, resource: opts.auditResource } }
      : {});
  };
}
