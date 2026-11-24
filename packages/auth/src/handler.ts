// Envelope de segurança em volta do handler do Better Auth (rota /api/auth/*):
// lista de rotas permitidas (o resto é 404), cadastro público = 404, limite de tentativas por conta e por IP,
// auditoria de login. Não confie em x-forwarded-for fora de um proxy da Vertra que o reescreva.
import { apiError } from '@ln/contracts';
import { audit } from './audit';
import { acquireAttempt, releaseAttempt, resetAccount, type Acquire } from './attempts';
import { chargePasswordAttempt, passwordNotChecked, passwordOk, type PasswordCharge } from './password-attempts';
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
  // /change-password fica de fora: a troca de senha só passa por changeOwnPassword (change-password.ts: 2º fator, política, limite e auditoria)
  { method: 'POST', path: '/two-factor/enable' },
  { method: 'POST', path: '/two-factor/disable' },
  { method: 'POST', path: '/two-factor/verify-totp' },
  { method: 'POST', path: '/two-factor/get-totp-uri' },
  { method: 'POST', path: '/two-factor/generate-backup-codes' },
  { method: 'POST', path: '/two-factor/verify-backup-code' },
];

const notFound = () => Response.json(apiError('NOT_FOUND', 'Rota inexistente.'), { status: 404 });

// Limite de tentativas do 2º FATOR (mesmos parâmetros do sign-in: 5 por 15 min, bloqueio de 15 min): sem ele um atacante que já tem a senha cria um desafio novo a cada
// 5 códigos (o Better Auth só limita por desafio, e o login correto zera o contador da conta) e adivinha os 6 dígitos. O sujeito é o USUÁRIO do desafio (cookie two_factor
// pendente) ou da sessão, e o IP; os contadores são separados dos do sign-in (prefixo `2fa:`) e valem para TOTP e código de recuperação juntos.
const TWO_FACTOR_VERIFY: ReadonlySet<string> = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

// Rotas do 2º fator que CONFEREM A SENHA da sessão: sem limite próprio, com uma sessão roubada viram oráculo da senha atual (o Better Auth
// só limita em memória, ~1000/h). Usam o MESMO contador da troca de senha (password-attempts.ts: `senha:<userId>` e `senha:<ip>`),
// pré-cobrado; só senha errada (400 INVALID_PASSWORD) fica cobrada. Auditoria `senha.verificacao_*` sem senha.
const PASSWORD_CHECKED: ReadonlySet<string> = new Set(['/two-factor/enable', '/two-factor/disable', '/two-factor/get-totp-uri', '/two-factor/generate-backup-codes']);

/** true quando o Better Auth recusou pela senha (400 INVALID_PASSWORD). */
async function wrongPassword(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  const body = (await res.clone().json().catch(() => null)) as { code?: unknown } | null;
  return body?.code === 'INVALID_PASSWORD';
}

/** Id do usuário que está tentando o 2º fator: o do desafio pendente (cookie assinado `two_factor`) ou o da sessão. Sem nenhum dos dois: null (só vale o limite por IP). */
async function twoFactorUserId(auth: Auth, request: Request): Promise<string | null> {
  try {
    const ctx = await auth.$context;
    const name = ctx.createAuthCookie('two_factor').name;
    const raw = (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
    if (raw) {
      const identifier = decodeURIComponent(raw).split('.')[0] ?? '';
      const found = identifier ? await ctx.internalAdapter.findVerificationValue(identifier) : null;
      if (found && new Date(found.expiresAt).getTime() > Date.now() && found.value) return String(found.value);
    }
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

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

    let userSubject: string | null = null;
    let ipSubject: string | null = null;
    if (TWO_FACTOR_VERIFY.has(path)) {
      const userId = await twoFactorUserId(auth, request);
      userSubject = userId ? `2fa:${userId}` : null;
      ipSubject = ip ? `2fa:${ip}` : null;
      // pré-cobra (atômico por sujeito) ANTES de verificar o código: N simultâneas não passam de 5
      const byUser: Acquire = userSubject ? await acquireAttempt(db, 'conta', userSubject, t) : { allowed: true };
      const byIp: Acquire = ipSubject ? await acquireAttempt(db, 'ip', ipSubject, t) : { allowed: true };
      if (!byUser.allowed || !byIp.allowed) {
        if (byUser.allowed && userSubject) await releaseAttempt(db, 'conta', userSubject);
        if (byIp.allowed && ipSubject) await releaseAttempt(db, 'ip', ipSubject);
        const until = !byUser.allowed ? byUser.until : (byIp as { until: Date }).until;
        await audit(db, { action: 'login.2fa_bloqueado', resource: 'sessao', ip, detalhe: { ...(userId ? { usuario: userId } : {}), via: path === '/two-factor/verify-totp' ? 'totp' : 'codigo_recuperacao', ate: until.toISOString() }, at: t });
        const retry = Math.max(1, Math.ceil((until.getTime() - t.getTime()) / 1000));
        return Response.json(apiError('TOO_MANY_ATTEMPTS', 'Muitas tentativas. Tente novamente mais tarde.'), { status: 429, headers: { 'Retry-After': String(retry) } });
      }
    }

    let passwordCharge: PasswordCharge | null = null;
    let passwordUser: string | null = null;
    if (PASSWORD_CHECKED.has(path)) {
      let userId: string | null = null;
      try {
        userId = (await auth.api.getSession({ headers: request.headers }))?.user?.id ?? null;
      } catch {
        // sem sessão legível: só o limite por IP se aplica (o Better Auth responde 401)
      }
      const gate = await chargePasswordAttempt(db, userId, ip, t);
      if (!gate.allowed) {
        await audit(db, { actorId: userId, action: 'senha.verificacao_bloqueada', resource: 'sessao', resourceId: userId, ip, detalhe: { rota: path, ate: gate.until.toISOString() }, at: t });
        return Response.json(apiError('TOO_MANY_ATTEMPTS', 'Muitas tentativas com a senha errada. Tente novamente mais tarde.'), { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } });
      }
      passwordCharge = gate.charge;
      passwordUser = userId;
    }

    const res = await auth.handler(request);
    if (passwordCharge) {
      if (res.ok) await passwordOk(db, passwordCharge);
      else if (await wrongPassword(res)) await audit(db, { actorId: passwordUser, action: 'senha.verificacao_falha', resource: 'sessao', resourceId: passwordUser, ip, detalhe: { rota: path }, at: t });
      else await passwordNotChecked(db, passwordCharge);
    }
    if (TWO_FACTOR_VERIFY.has(path) && res.ok) {
      // código certo: zera o contador do usuário e devolve a cobrança do IP (como no sign-in)
      if (userSubject) await resetAccount(db, userSubject);
      if (ipSubject) await releaseAttempt(db, 'ip', ipSubject);
    }
    const acao: Record<string, string> = {
      '/two-factor/verify-totp': res.ok ? 'login.2fa_ok' : 'login.2fa_falha',
      '/two-factor/verify-backup-code': res.ok ? 'login.2fa_codigo_recuperacao_ok' : 'login.2fa_codigo_recuperacao_falha',
      '/two-factor/enable': 'mfa.ativacao_iniciada',
      '/two-factor/disable': 'mfa.desativado',
      '/sign-out': 'sessao.encerrada',
      '/revoke-session': 'sessao.revogada',
      '/revoke-sessions': 'sessao.revogada_todas',
      '/revoke-other-sessions': 'sessao.revogada_outras',
    };
    const action = acao[path];
    if (action) await audit(db, { action, resource: 'sessao', ip, detalhe: { status: res.status }, at: t });
    return res;
  };
}
