// Envelope de segurança em volta do handler do Better Auth (rota /api/auth/*):
// lista de rotas permitidas (o resto é 404), cadastro público = 404, limite de tentativas por conta e por IP,
// auditoria de login. Não confie em x-forwarded-for fora de um proxy da Vertra que o reescreva.
import { apiError } from '@ln/contracts';
import { audit } from './audit';
import { acquireAttempt, releaseAttempt, resetAccount, type Acquire } from './attempts';
import { clientIp, trustedProxyHops } from './client-ip';
import type { Auth } from './server';
import type { Db } from './types';

const ALLOWED: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/sign-in/email' },
  { method: 'POST', path: '/sign-out' },
  { method: 'GET', path: '/get-session' },
  { method: 'GET', path: '/list-sessions' },
  { method: 'POST', path: '/revoke-session' },
  { method: 'POST', path: '/revoke-sessions' },
  { method: 'POST', path: '/revoke-other-sessions' },
  { method: 'POST', path: '/change-password' },
  { method: 'POST', path: '/two-factor/enable' },
  { method: 'POST', path: '/two-factor/disable' },
  { method: 'POST', path: '/two-factor/verify-totp' },
  { method: 'POST', path: '/two-factor/get-totp-uri' },
  { method: 'POST', path: '/two-factor/generate-backup-codes' },
  { method: 'POST', path: '/two-factor/verify-backup-code' },
];

const notFound = () => Response.json(apiError('NOT_FOUND', 'Rota inexistente.'), { status: 404 });

export interface AuthHandlerOptions {
  auth: Auth;
  db: Db;
  basePath?: string;
  now?: () => Date;
  /** Proxies confiáveis na frente do app (ver client-ip.ts). Padrão: TRUSTED_PROXY_HOPS do ambiente, senão 0. */
  trustedProxyHops?: number;
}

export function createAuthHandler({ auth, db, basePath = '/api/auth', now = () => new Date(), trustedProxyHops: hops = trustedProxyHops() }: AuthHandlerOptions) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname;
    const method = request.method.toUpperCase();
    if (!ALLOWED.some((r) => r.method === method && r.path === path)) return notFound();

    const ip = clientIp(request.headers, hops);
    const t = now();

    if (path === '/sign-in/email') {
      let email: string;
      try {
        const body = (await request.clone().json()) as { email?: unknown };
        email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      } catch {
        return Response.json(apiError('INVALID_REQUEST', 'Corpo JSON inválido.'), { status: 400 });
      }
      // Pré-cobra a tentativa (atômico por sujeito) ANTES de verificar a senha: N simultâneas não passam de 5.
      const byAccount: Acquire = email ? await acquireAttempt(db, 'conta', email, t) : { allowed: true };
      const byIp: Acquire = ip ? await acquireAttempt(db, 'ip', ip, t) : { allowed: true };
      if (!byAccount.allowed || !byIp.allowed) {
        // a requisição é barrada: devolve a cobrança do limite que a deixaria passar
        if (byAccount.allowed && email) await releaseAttempt(db, 'conta', email);
        if (byIp.allowed && ip) await releaseAttempt(db, 'ip', ip);
        const until = !byAccount.allowed ? byAccount.until : (byIp as { until: Date }).until;
        await audit(db, { action: 'login.bloqueado', resource: 'sessao', ip, detalhe: { email, ate: until.toISOString() }, at: t });
        const retry = Math.max(1, Math.ceil((until.getTime() - t.getTime()) / 1000));
        return Response.json(apiError('TOO_MANY_ATTEMPTS', 'Muitas tentativas. Tente novamente mais tarde.'), {
          status: 429,
          headers: { 'Retry-After': String(retry) },
        });
      }
      const res = await auth.handler(request);
      if (res.status === 200) {
        if (email) await resetAccount(db, email);
        if (ip) await releaseAttempt(db, 'ip', ip);
        const twoFactor = (await res.clone().json().catch(() => null)) as { twoFactorRedirect?: boolean } | null;
        await audit(db, {
          action: twoFactor?.twoFactorRedirect ? 'login.senha_ok_aguarda_2fa' : 'login.ok_sem_2fa',
          resource: 'sessao',
          ip,
          detalhe: { email },
          at: t,
        });
      } else {
        await audit(db, { action: 'login.falha', resource: 'sessao', ip, detalhe: { email, status: res.status }, at: t });
      }
      return res;
    }

    const res = await auth.handler(request);
    const acao: Record<string, string> = {
      '/two-factor/verify-totp': res.ok ? 'login.2fa_ok' : 'login.2fa_falha',
      '/two-factor/enable': 'mfa.ativacao_iniciada',
      '/two-factor/disable': 'mfa.desativado',
      '/sign-out': 'sessao.encerrada',
      '/revoke-session': 'sessao.revogada',
      '/revoke-sessions': 'sessao.revogada_todas',
      '/revoke-other-sessions': 'sessao.revogada_outras',
      '/change-password': 'senha.alterada',
    };
    const action = acao[path];
    if (action) await audit(db, { action, resource: 'sessao', ip, detalhe: { status: res.status }, at: t });
    return res;
  };
}
