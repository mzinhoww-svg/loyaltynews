// Falha ao LER a sessão (banco/conexão) não pode virar "sem sessão" (bug do staging int/024: a pessoa era mandada à entrada sem motivo e sem rastro).
import { describe, expect, it } from 'vitest';
import { APIError } from 'better-auth/api';
import { AccessDeniedError, SessionLookupError, authorize, changeOwnPassword, sessionFromHeaders, type Auth, type Db } from './index';

const fakeAuth = (getSession: () => Promise<unknown>) => ({ api: { getSession } }) as unknown as Auth;
const h = new Headers({ cookie: 'better-auth.session_token=abc' });

describe('sessionFromHeaders: sem sessão × falha ao conferir', () => {
  it('sem sessão (null do Better Auth) e sessão apagada no meio da renovação (UNAUTHORIZED / FAILED_TO_GET_SESSION): null, sem log', async () => {
    const logs: string[] = [];
    expect(await sessionFromHeaders(fakeAuth(async () => null), h, (l) => logs.push(l))).toBeNull();
    expect(await sessionFromHeaders(fakeAuth(async () => { throw APIError.from('UNAUTHORIZED', { message: 'Failed to get session', code: 'FAILED_TO_GET_SESSION' }); }), h, (l) => logs.push(l))).toBeNull();
    expect(logs).toEqual([]);
  });

  it('erro de banco/conexão: lança SessionLookupError (mensagem pt-BR) e registra só a classe/código, sem URL, host ou senha', async () => {
    const logs: string[] = [];
    const erroPg = Object.assign(new Error('connect ECONNRESET postgres://app:SENHA-DO-BANCO@db.example.invalid:5432/ln'), { code: 'ECONNRESET' });
    await expect(sessionFromHeaders(fakeAuth(async () => { throw erroPg; }), h, (l) => logs.push(l))).rejects.toBeInstanceOf(SessionLookupError);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('[auth] falha ao ler a sessão');
    expect(logs[0]).not.toContain('SENHA-DO-BANCO');
    expect(logs[0]).not.toContain('db.example.invalid');
    expect(new SessionLookupError().message).toBe('Não foi possível conferir a sua sessão agora. Tente de novo em instantes.');
  });

  it('authorize repassa a falha (não vira AccessDeniedError NO_SESSION)', async () => {
    const auth = fakeAuth(async () => { throw new Error('Connection terminated unexpectedly'); });
    const e = await authorize(auth, h, 'materias', 'read').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SessionLookupError);
    expect(e).not.toBeInstanceOf(AccessDeniedError);
  });

  it('troca de senha: falha ao conferir a sessão responde 503 SESSION_UNAVAILABLE (não 401, que mandaria à entrada)', async () => {
    const auth = fakeAuth(async () => { throw new Error('timeout exceeded when trying to connect'); });
    const r = await changeOwnPassword({ auth, db: {} as Db, headers: h, ip: null }, { atual: 'a'.repeat(12), nova: 'b'.repeat(12), confirmacao: 'b'.repeat(12) });
    expect(r).toMatchObject({ ok: false, status: 503, code: 'SESSION_UNAVAILABLE' });
  });
});
