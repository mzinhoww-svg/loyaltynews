import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import {
  ATTEMPT_RETENTION_MS,
  ATTEMPT_TAG,
  LOCK_MS,
  MAX_FAILURES,
  acquireAttempt,
  attemptKey,
  attemptSubject,
  auditIp,
  blockedUntil,
  clearAttempts,
  purgeStaleAttempts,
  releaseAttempt,
  resetAccount,
} from './attempts';
import { chargePasswordAttempt, passwordOk } from './password-attempts';
import { normalizeIp } from './client-ip';
import { audit } from './audit';

// Privacidade (LGPD): o banco nunca guarda IP nem e-mail em claro em `auth_attempt`; só o HMAC `h1:<hex>` de kind + sujeito (attempts.ts).
let t: Awaited<ReturnType<typeof createTestDb>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => t.db as any;
const T0 = new Date('2026-11-25T12:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const rows = () => db().select().from(schema.authAttempt) as Promise<Array<{ kind: string; subject: string; failures: number; windowStart: Date; lockedUntil: Date | null }>>;

beforeAll(async () => { t = await createTestDb(); }, 120_000);
afterAll(async () => t.close());

describe('o banco não guarda IP nem e-mail em claro', () => {
  it('limite por IP, por conta, senha:<ip>, formulário (agenda:, titular:, recurso:) e 2fa: gravam só h1:<hex>', async () => {
    await db().delete(schema.authAttempt);
    const IP = '203.0.113.77';
    const EMAIL = 'pessoa.real@exemplo-real.com';
    await acquireAttempt(db(), 'ip', IP, T0);
    await acquireAttempt(db(), 'conta', EMAIL, T0);
    await acquireAttempt(db(), 'ip', `senha:${IP}`, T0);
    await acquireAttempt(db(), 'conta', 'senha:user-123', T0);
    await acquireAttempt(db(), 'ip', `2fa:${IP}`, T0);
    await acquireAttempt(db(), 'conta', '2fa:user-123', T0);
    await acquireAttempt(db(), 'form', `agenda:${IP}`, T0);
    await acquireAttempt(db(), 'form', `comercial:${IP}`, T0);
    await acquireAttempt(db(), 'form', `titular:${IP}`, T0);
    await acquireAttempt(db(), 'form', 'titular-contato:abc', T0);
    const all = await rows();
    expect(all).toHaveLength(10);
    for (const r of all) expect(r.subject, r.kind).toMatch(new RegExp(`^${ATTEMPT_TAG}[0-9a-f]{64}$`));
    // procurar o texto na tabela inteira (o que um dump veria)
    const dump = (await t.client.query<{ j: string }>('SELECT row_to_json(a)::text j FROM auth_attempt a')).rows.map((r) => r.j).join('\n');
    for (const proibido of [IP, '203.0.113', EMAIL, 'exemplo-real', 'pessoa.real', 'user-123', 'agenda', 'titular']) expect(dump, proibido).not.toContain(proibido);
  });

  it('o mesmo sujeito em kinds diferentes gera sujeitos diferentes (kind entra no HMAC); a chave não aparece em lugar nenhum', () => {
    expect(attemptSubject('ip', '1.2.3.4')).not.toBe(attemptSubject('conta', '1.2.3.4'));
    expect(attemptSubject('ip', '1.2.3.4')).toBe(attemptSubject('ip', '1.2.3.4'));
    expect(attemptSubject('ip', '1.2.3.4')).not.toBe(attemptSubject('ip', '1.2.3.5'));
  });
});

describe('o limite continua exato', () => {
  it('bloqueia na 5ª falha, não consome nem estende o bloqueio, e libera em 15 min', async () => {
    await db().delete(schema.authAttempt);
    for (let i = 0; i < MAX_FAILURES; i++) expect((await acquireAttempt(db(), 'ip', '198.51.100.9', at(i))).allowed).toBe(true);
    const bloqueada = await acquireAttempt(db(), 'ip', '198.51.100.9', at(6));
    expect(bloqueada.allowed).toBe(false);
    const ate = await blockedUntil(db(), 'ip', '198.51.100.9', at(6));
    expect(ate?.getTime()).toBe(at(4).getTime() + LOCK_MS); // o bloqueio nasceu na 5ª tentativa e não se moveu
    expect((await acquireAttempt(db(), 'ip', '198.51.100.9', at(4 + 14))).allowed).toBe(false);
    expect((await acquireAttempt(db(), 'ip', '198.51.100.9', at(4 + 15 + 1))).allowed).toBe(true);
  });

  it('as grafias do mesmo IP (IPv6 maiúsculo, com zona, IPv4 mapeado) caem no MESMO contador', async () => {
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('::FFFF:0102:0304')).toBe('1.2.3.4');
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeIp('não-é-ip')).toBeNull();
    await db().delete(schema.authAttempt);
    const grafias = ['::ffff:1.2.3.4', '::FFFF:0102:0304', '1.2.3.4', '::ffff:1.2.3.4', '1.2.3.4'];
    for (const [i, g] of grafias.entries()) expect((await acquireAttempt(db(), 'ip', normalizeIp(g)!, at(i))).allowed).toBe(true);
    expect((await acquireAttempt(db(), 'ip', normalizeIp('::ffff:1.2.3.4')!, at(6))).allowed).toBe(false);
    expect(await rows()).toHaveLength(1);
  });

  it('releaseAttempt e resetAccount acham a linha pelo valor lógico (senha certa devolve a cobrança do IP; login certo zera a conta)', async () => {
    await db().delete(schema.authAttempt);
    const gate = await chargePasswordAttempt(db(), 'user-9', '203.0.113.5', at(0));
    expect(gate.allowed).toBe(true);
    expect((await rows()).map((r) => r.failures).sort()).toEqual([1, 1]);
    if (gate.allowed) await passwordOk(db(), gate.charge);
    const depois = await rows();
    expect(depois).toHaveLength(1); // a conta foi zerada (apagada); a cobrança do IP voltou a 0
    expect(depois[0]).toMatchObject({ kind: 'ip', failures: 0 });
    await acquireAttempt(db(), 'conta', 'Fulano@Exemplo.com ', at(0));
    await acquireAttempt(db(), 'conta', 'fulano@exemplo.com', at(1));
    expect((await rows()).filter((r) => r.kind === 'conta')[0]!.failures).toBe(2); // e-mail em outra caixa/espaços: mesmo contador
    await releaseAttempt(db(), 'conta', 'fulano@exemplo.com');
    expect((await rows()).filter((r) => r.kind === 'conta')[0]!.failures).toBe(1);
    await resetAccount(db(), 'FULANO@exemplo.com');
    expect((await rows()).filter((r) => r.kind === 'conta')).toHaveLength(0);
  });
});

describe('desbloqueio (prod-admin) por clearAttempts', () => {
  it('apaga as linhas certas pelo valor lógico e só elas', async () => {
    await db().delete(schema.authAttempt);
    for (let i = 0; i < MAX_FAILURES; i++) await acquireAttempt(db(), 'conta', 'dono@exemplo-real.com', at(i));
    await acquireAttempt(db(), 'conta', '2fa:u1', at(0));
    await acquireAttempt(db(), 'conta', 'outro@exemplo-real.com', at(0));
    expect(await blockedUntil(db(), 'conta', 'dono@exemplo-real.com', at(5))).not.toBeNull();
    const n = await clearAttempts(db(), [{ kind: 'conta', subject: 'dono@exemplo-real.com' }, { kind: 'conta', subject: '2fa:u1' }]);
    expect(n).toBe(2);
    expect(await blockedUntil(db(), 'conta', 'dono@exemplo-real.com', at(5))).toBeNull();
    const resto = await rows();
    expect(resto).toHaveLength(1);
    expect(resto[0]!.subject).toBe(attemptSubject('conta', 'outro@exemplo-real.com'));
  });
});

describe('chave: falha fechada', () => {
  it('em produção sem BETTER_AUTH_SECRET nem LN_ATTEMPT_HMAC_KEY, calcular o sujeito lança (nada é gravado cru); a mensagem não cita valor', () => {
    expect(() => attemptKey({ APP_ENV: 'production' })).toThrow(/chave do limite de tentativas ausente/);
    expect(() => attemptKey({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'curto' })).toThrow(/ausente/);
    expect(() => attemptSubject('ip', '1.2.3.4', { APP_ENV: 'production' })).toThrow();
    try { attemptKey({ APP_ENV: 'production', BETTER_AUTH_SECRET: 'segredo-curto-demais' }); } catch (e) { expect((e as Error).message).not.toContain('segredo-curto'); }
  });

  it('LN_ATTEMPT_HMAC_KEY curta é recusada; longa vale e tem prioridade; com a mesma chave o sujeito é estável e com outra muda', () => {
    expect(() => attemptKey({ LN_ATTEMPT_HMAC_KEY: 'curta' })).toThrow(/curta/);
    const A = 'a'.repeat(40);
    const B = 'b'.repeat(40);
    expect(attemptSubject('ip', '1.2.3.4', { LN_ATTEMPT_HMAC_KEY: A })).toBe(attemptSubject('ip', '1.2.3.4', { LN_ATTEMPT_HMAC_KEY: A, BETTER_AUTH_SECRET: B }));
    expect(attemptSubject('ip', '1.2.3.4', { LN_ATTEMPT_HMAC_KEY: A })).not.toBe(attemptSubject('ip', '1.2.3.4', { LN_ATTEMPT_HMAC_KEY: B }));
    expect(attemptSubject('ip', '1.2.3.4', { BETTER_AUTH_SECRET: B })).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(attemptKey({ BETTER_AUTH_SECRET: B })).toHaveLength(32);
  });

  it('fora de produção sem chave (teste/dev) usa chave do processo: estável dentro dele', () => {
    expect(attemptSubject('ip', '1.2.3.4', {})).toBe(attemptSubject('ip', '1.2.3.4', {}));
  });

  it('o hash não é SHA-256 puro: não bate com sha256(kind\\0sujeito) (o espaço IPv4 não se inverte sem a chave)', async () => {
    const { createHash } = await import('node:crypto');
    const puro = ATTEMPT_TAG + createHash('sha256').update('ip\x001.2.3.4').digest('hex');
    expect(attemptSubject('ip', '1.2.3.4', { BETTER_AUTH_SECRET: 'z'.repeat(40) })).not.toBe(puro);
  });
});

describe('retenção: 24 h sem bloqueio vigente', () => {
  it('apaga linha vencida (>24 h) sem bloqueio e PRESERVA bloqueio em vigor e linha recente; bloqueio já vencido há >24 h também sai', async () => {
    await db().delete(schema.authAttempt);
    const now = at(0);
    const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
    const mk = (kind: string, s: string, windowStart: Date, lockedUntil: Date | null) => db().insert(schema.authAttempt).values({ kind, subject: attemptSubject(kind as 'ip', s), failures: 2, windowStart, lockedUntil });
    await mk('ip', 'velha-sem-bloqueio', h(25), null);
    await mk('ip', 'recente', h(2), null);
    await mk('ip', 'limite-menos', h(23), null);
    await mk('conta', 'velha-bloqueada-vigente', h(30), new Date(now.getTime() + 60_000)); // janela velha, bloqueio ainda vale
    await mk('conta', 'velha-bloqueio-vencido', h(30), h(29));
    const n = await purgeStaleAttempts(db(), now);
    expect(n).toBe(2);
    const subj = new Set((await rows()).map((r) => r.subject));
    expect(subj.has(attemptSubject('ip', 'velha-sem-bloqueio'))).toBe(false);
    expect(subj.has(attemptSubject('conta', 'velha-bloqueio-vencido'))).toBe(false);
    for (const s of [['ip', 'recente'], ['ip', 'limite-menos'], ['conta', 'velha-bloqueada-vigente']] as const) expect(subj.has(attemptSubject(s[0], s[1])), s[1]).toBe(true);
    expect(ATTEMPT_RETENTION_MS).toBe(24 * 3_600_000);
  });

  it('fronteira exata: 24 h menos 1 ms fica; 24 h mais 1 ms sai', async () => {
    await db().delete(schema.authAttempt);
    const now = at(0);
    const mk = (s: string, ms: number) => db().insert(schema.authAttempt).values({ kind: 'ip', subject: attemptSubject('ip', s), failures: 1, windowStart: new Date(now.getTime() - ms), lockedUntil: null });
    await mk('dentro', ATTEMPT_RETENTION_MS - 1);
    await mk('fora', ATTEMPT_RETENTION_MS + 1);
    expect(await purgeStaleAttempts(db(), now)).toBe(1);
    expect((await rows()).map((r) => r.subject)).toEqual([attemptSubject('ip', 'dentro')]);
  });
});

describe('migração 0030', () => {
  it('apaga as linhas no formato antigo (IP e e-mail crus) e registra a mudança; o down só tira o registro', async () => {
    const { readFileSync } = await import('node:fs');
    const up = readFileSync(new URL('../../db/drizzle/0030_auth_attempt_hmac.sql', import.meta.url), 'utf8');
    expect(up).toMatch(/DELETE FROM "auth_attempt"/);
    await db().delete(schema.authAttempt);
    await t.client.query("INSERT INTO auth_attempt (kind, subject, failures, window_start) VALUES ('ip', '203.0.113.9', 3, now()), ('conta', 'velho@exemplo.com', 2, now())");
    await t.client.query(up.split('\n').filter((l) => !l.startsWith('--')).join('\n'));
    expect(await rows()).toHaveLength(0);
    const down = readFileSync(new URL('../../db/drizzle/down/0030_auth_attempt_hmac.down.sql', import.meta.url), 'utf8');
    expect(down).toMatch(/DELETE FROM drizzle\.__drizzle_migrations WHERE created_at = \d+/);
  });
});

describe('audit_log (append-only): o IP entra só como HMAC', () => {
  it('audit() grava h1:<hex> no lugar do IP; mesmo IP (qualquer grafia) = mesmo código; IP diferente = outro; sem IP = null; texto que não é IP = null', async () => {
    await db().delete(schema.authAttempt);
    const antes = (await t.client.query<{ n: number }>('SELECT count(*)::int n FROM audit_log')).rows[0]!.n;
    await audit(db(), { action: 'teste.ip', resource: 'teste', resourceId: 'a', ip: '203.0.113.50' });
    await audit(db(), { action: 'teste.ip', resource: 'teste', resourceId: 'b', ip: '::ffff:203.0.113.50' });
    await audit(db(), { action: 'teste.ip', resource: 'teste', resourceId: 'c', ip: '203.0.113.51' });
    await audit(db(), { action: 'teste.ip', resource: 'teste', resourceId: 'd', ip: null });
    await audit(db(), { action: 'teste.ip', resource: 'teste', resourceId: 'e', ip: 'nao-e-ip' });
    const r = (await t.client.query<{ resource_id: string; ip: string | null }>("SELECT resource_id, ip FROM audit_log WHERE action = 'teste.ip' ORDER BY resource_id")).rows;
    expect(r).toHaveLength(5);
    const por = Object.fromEntries(r.map((x) => [x.resource_id, x.ip]));
    expect(por.a).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(por.b).toBe(por.a);
    expect(por.c).not.toBe(por.a);
    expect(por.d).toBeNull();
    expect(por.e).toBeNull();
    const dump = (await t.client.query<{ j: string }>("SELECT row_to_json(a)::text j FROM audit_log a WHERE action = 'teste.ip'")).rows.map((x) => x.j).join('\n');
    expect(dump).not.toContain('203.0.113');
    expect((await t.client.query<{ n: number }>('SELECT count(*)::int n FROM audit_log')).rows[0]!.n).toBe(antes + 5);
  });

  it('o código da auditoria é de OUTRO domínio que o do limite (hashes diferentes para o mesmo IP); sem chave em produção devolve null, nunca o IP', () => {
    expect(auditIp('1.2.3.4')).not.toBe(attemptSubject('ip', '1.2.3.4'));
    expect(auditIp('1.2.3.4', { APP_ENV: 'production' })).toBeNull();
    expect(auditIp('1.2.3.4', { APP_ENV: 'production', BETTER_AUTH_SECRET: 'k'.repeat(40) })).toMatch(/^h1:[0-9a-f]{64}$/);
  });
});
