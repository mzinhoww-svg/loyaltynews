// Privacidade (LGPD): o audit_log é append-only, então e-mail em claro NUNCA pode entrar nele. O limite por conta e a trilha continuam.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { EMAIL_REMOVIDO, attemptSubject, audit, auditEmail, createAuth, createAuthHandler, createStaffUser, stripEmails } from './index';
import type { Db } from './types';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'senha-longa-de-teste-1';
const SEM_2FA = 'maria.silva+teste@exemplo-real.com.br';
const COM_2FA = 'joao.souza@exemplo-real.com';
const INEXISTENTE = 'ninguem.cadastrado@dominio-qualquer.org';
const BLOQUEADO = 'alvo.do.ataque@exemplo-real.com';
const SENHA_NO_CAMPO = 'Senha-Colada-No-Campo-Errado!';

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let auth: ReturnType<typeof createAuth>;
let handle: (r: Request) => Promise<Response>;
const status: Record<string, number[]> = {};

const req = (path: string, body: unknown, cookie?: string) =>
  new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const login = async (quem: string, email: string, password = PASSWORD) => {
  const res = await handle(req('/sign-in/email', { email, password }));
  (status[quem] ??= []).push(res.status);
  return res;
};
const linhas = () => db.select().from(schema.auditLog);
/** O detector usado nas provas: devolve o que vazou. Procura cada valor digitado e qualquer `@`, sem diferenciar maiúsculas. */
const vazamentos = (rows: unknown, digitados: readonly string[]) => {
  const dump = JSON.stringify(rows).toLowerCase();
  return [...digitados, '@'].filter((v) => dump.includes(v.toLowerCase()));
};
const DIGITADOS = [SEM_2FA, COM_2FA, INEXISTENTE, BLOQUEADO, SENHA_NO_CAMPO, 'maria.silva', 'joao.souza', 'ninguem.cadastrado', 'alvo.do.ataque', PASSWORD];

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN });
  handle = createAuthHandler({ auth, db });
  for (const email of [SEM_2FA, COM_2FA, BLOQUEADO]) await createStaffUser(auth, { email, name: 'Pessoa de Teste', password: PASSWORD, role: 'editor' });

  // 2º fator ativo para uma das contas
  const first = await login('enrolamento', COM_2FA);
  const cookie = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const enable = await handle(req('/two-factor/enable', { password: PASSWORD }, cookie));
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const raw = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get('secret')!));
  const ok = await handle(req('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, cookie));
  if (!ok.ok) throw new Error(`TOTP não ativado (HTTP ${ok.status})`);

  await login('certo-sem-2fa', SEM_2FA.toUpperCase());
  await login('senha-errada', SEM_2FA, 'senha-errada-123');
  await login('certo-com-2fa', COM_2FA);
  await login('inexistente', INEXISTENTE);
  await login('campo-errado', SENHA_NO_CAMPO);
  for (let i = 0; i < 5; i++) await login('bloqueio', BLOQUEADO, 'senha-errada-123');
  await login('bloqueio', BLOQUEADO); // 6ª, com a senha certa
}, 120_000);
afterAll(async () => { await t.close(); });

describe('login: o e-mail digitado não chega à auditoria', () => {
  it('certo, com 2º fator, errado, inexistente e bloqueado: nenhuma linha traz e-mail, texto digitado ou senha', async () => {
    const rows = await linhas();
    expect([...new Set(rows.map((r) => r.action))]).toEqual(expect.arrayContaining(['login.ok_sem_2fa', 'login.senha_ok_aguarda_2fa', 'login.falha', 'login.bloqueado']));
    expect(vazamentos(rows, DIGITADOS)).toEqual([]);
  });

  it('a trilha fica: toda linha de senha leva o código do e-mail, o mesmo para a mesma conta (maiúsculas não mudam) e diferente entre contas', async () => {
    const rows = await linhas();
    const deSenha = rows.filter((r) => ['login.ok_sem_2fa', 'login.senha_ok_aguarda_2fa', 'login.falha', 'login.bloqueado'].includes(r.action));
    expect(deSenha).toHaveLength(12);
    for (const r of deSenha) expect((r.detalhe as { emailRef?: string }).emailRef, r.action).toMatch(/^h1:[0-9a-f]{64}$/);
    const daConta = (email: string) => deSenha.filter((r) => (r.detalhe as { emailRef: string }).emailRef === auditEmail(email)).map((r) => r.action).sort();
    expect(daConta(SEM_2FA)).toEqual(['login.falha', 'login.ok_sem_2fa']);
    expect(daConta(BLOQUEADO)).toEqual(['login.bloqueado', 'login.falha', 'login.falha', 'login.falha', 'login.falha', 'login.falha']);
    expect(daConta(INEXISTENTE)).toEqual(['login.falha']);
    expect(new Set([SEM_2FA, COM_2FA, INEXISTENTE, BLOQUEADO].map((e) => auditEmail(e))).size).toBe(4);
  });

  it('o limite por conta continua: 5 falhas e a 6ª, mesmo com a senha certa, é 429', () => {
    expect(status.bloqueio!.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(status.bloqueio![5]).toBe(429);
  });

  it('o código da auditoria tem domínio próprio (não casa com auth_attempt) e depende da chave; sem chave em produção não grava nada cru', () => {
    expect(auditEmail(`  ${SEM_2FA.toUpperCase()} `)).toBe(auditEmail(SEM_2FA));
    expect(auditEmail(SEM_2FA)).not.toBe(attemptSubject('conta', SEM_2FA));
    const a = auditEmail(SEM_2FA, { BETTER_AUTH_SECRET: 'a'.repeat(40) });
    expect(a).not.toBe(auditEmail(SEM_2FA, { BETTER_AUTH_SECRET: 'b'.repeat(40) }));
    expect(auditEmail(SEM_2FA, { APP_ENV: 'production' })).toBeNull();
    expect(auditEmail('   ')).toBeNull();
  });
});

describe('controle negativo e segunda barreira em audit()', () => {
  it('o detector reprova quando o e-mail em claro está na linha (inserção direta, sem audit())', async () => {
    const plantada = [{ detalhe: { email: SEM_2FA.toUpperCase() } }];
    expect(vazamentos(plantada, DIGITADOS)).toEqual(expect.arrayContaining([SEM_2FA, 'maria.silva', '@']));
  });

  it('chamador que passe e-mail (valor, texto livre, chave, lista, actorId, resourceId) grava sem ele', async () => {
    const action = `teste.barreira.${randomUUID()}`;
    await audit(db, {
      action, resource: 'sessao', actorId: SEM_2FA, resourceId: `contato:${COM_2FA}`,
      detalhe: { email: SEM_2FA, motivo: `confirmado por ${INEXISTENTE}, ok`, lista: [BLOQUEADO, { [COM_2FA]: 'josé@domínio.com.br' }] },
    });
    const [row] = (await linhas()).filter((r) => r.action === action);
    expect(vazamentos(row, [...DIGITADOS, 'josé'])).toEqual([]);
    expect(row).toMatchObject({ actorId: EMAIL_REMOVIDO, resourceId: `contato:${EMAIL_REMOVIDO}` });
    expect((row!.detalhe as { motivo: string }).motivo).toBe(`confirmado por ${EMAIL_REMOVIDO}, ok`);
  });

  it('não mexe no que não é e-mail e responde rápido a texto grande e hostil', () => {
    const intacto = { emailDominio: 'exemplo-real.com', pacote: 'esbuild@0.28.2', n: 3, ok: true, nada: null, ref: 'h1:abc', arroba: '@ln/auth' };
    expect(stripEmails(intacto)).toEqual(intacto);
    const inicio = Date.now();
    stripEmails(`${'a'.repeat(200_000)}@${'b.'.repeat(50_000)}`);
    expect(Date.now() - inicio).toBeLessThan(5_000);
  });
});
