import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { AUDIT_IP_MESES, purgeAuditIps, startAuditIpRetention } from './audit-ip-retention';

// Decisão do PM (25/11): o código de IP do audit_log fica 12 meses e é anulado; a linha e o resto do registro ficam. Única exceção ao append-only (migração 0033).
const NOW = new Date('2026-11-25T12:00:00Z');
const dias = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
let t: Awaited<ReturnType<typeof createTestDb>>;
const db = () => t.db as unknown as Db;
beforeEach(async () => { t = await createTestDb(); }, 120_000);
afterEach(async () => t.close());

const HASH = (c: string) => `h1:${c.repeat(64)}`;
async function put(id: string, at: Date, ip: string | null, extra: { action?: string; resource?: string } = {}) {
  await t.client.query(
    "INSERT INTO audit_log (id, at, actor_id, actor_role, action, resource, resource_id, ip, detalhe) VALUES ($1, $2, 'u1', 'admin', $3, $4, 'r1', $5, '{\"k\":\"v\"}'::jsonb)",
    [id, at, extra.action ?? 'teste.acao', extra.resource ?? 'teste', ip],
  );
}
const row = async (id: string) => (await t.client.query<Record<string, unknown>>('SELECT * FROM audit_log WHERE id = $1', [id])).rows[0]!;

describe('anulação do IP do audit_log depois de 12 meses', () => {
  it('12 meses menos 1 dia mantém; mais 1 dia anula; só a coluna ip muda e a linha fica inteira', async () => {
    await put('a-dentro', dias(364), HASH('a'));
    await put('a-fora', dias(367), HASH('b'));
    await put('a-recente', dias(1), HASH('c'));
    const antes = await row('a-fora');
    expect(await purgeAuditIps(db(), NOW)).toBe(1);
    expect((await row('a-dentro')).ip).toBe(HASH('a'));
    expect((await row('a-recente')).ip).toBe(HASH('c'));
    const depois = await row('a-fora');
    expect(depois.ip).toBeNull();
    expect({ ...depois, ip: null }).toEqual({ ...antes, ip: null }); // nada mais mudou (id, at, ator, ação, recurso, detalhe)
    expect((await t.client.query<{ n: number }>('SELECT count(*)::int n FROM audit_log')).rows[0]!.n).toBe(3); // nenhuma linha apagada
    expect(AUDIT_IP_MESES).toBe(12);
  });

  it('idempotente; linha sem IP e linha antiga com IP de outra grafia entram na mesma regra; devolve só a contagem', async () => {
    await put('b1', dias(500), HASH('d'));
    await put('b2', dias(500), null);
    await put('b3', dias(800), '203.0.113.5'); // legado cru (staging): também é anulado
    expect(await purgeAuditIps(db(), NOW)).toBe(2);
    expect(await purgeAuditIps(db(), NOW)).toBe(0);
    for (const id of ['b1', 'b2', 'b3']) expect((await row(id)).ip, id).toBeNull();
  });
});

describe('o append-only continua valendo, com UMA exceção', () => {
  it('rejeita apagar, mudar qualquer outro campo, trocar o IP por outro valor e anular o IP junto de outra mudança', async () => {
    await put('c1', dias(10), HASH('e'));
    const rej = /append-only/;
    await expect(t.client.query("DELETE FROM audit_log WHERE id = 'c1'")).rejects.toThrow(rej);
    await expect(t.client.query("UPDATE audit_log SET action = 'x' WHERE id = 'c1'")).rejects.toThrow(rej);
    await expect(t.client.query("UPDATE audit_log SET detalhe = '{}'::jsonb WHERE id = 'c1'")).rejects.toThrow(rej);
    await expect(t.client.query("UPDATE audit_log SET at = now() WHERE id = 'c1'")).rejects.toThrow(rej);
    await expect(t.client.query("UPDATE audit_log SET ip = 'h1:outro' WHERE id = 'c1'")).rejects.toThrow(rej);
    await expect(t.client.query("UPDATE audit_log SET ip = NULL, action = 'x' WHERE id = 'c1'")).rejects.toThrow(rej);
    await expect(t.client.query("UPDATE audit_log SET ip = NULL, actor_id = NULL WHERE id = 'c1'")).rejects.toThrow(rej);
    expect((await row('c1')).ip).toBe(HASH('e')); // nada passou
    await t.client.query("UPDATE audit_log SET ip = NULL WHERE id = 'c1'"); // a exceção: só o IP, só para NULL
    expect((await row('c1')).ip).toBeNull();
    await expect(t.client.query("DELETE FROM audit_log WHERE id = 'c1'")).rejects.toThrow(rej);
  });

  it('as outras tabelas append-only (orçamento, efeitos, recibos) seguem totalmente travadas', async () => {
    const r = await t.client.query<{ tgname: string; fn: string }>("SELECT t.tgname, p.proname fn FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgname LIKE '%append_only'");
    const fn = Object.fromEntries(r.rows.map((x) => [x.tgname, x.fn]));
    expect(fn.audit_log_append_only).toBe('ln_audit_log_guard');
    for (const k of ['budget_ledger_append_only', 'effect_ledger_append_only', 'publication_receipts_append_only']) expect(fn[k], k).toBe('ln_reject_mutation');
  });
});

describe('migração 0032: zera o IP cru da sessão', () => {
  it('o SQL da migração anula auth_session.ip_address sem apagar a sessão', async () => {
    const { readFileSync } = await import('node:fs');
    const up = readFileSync(new URL('../../../packages/db/drizzle/0032_auth_session_ip_limpo.sql', import.meta.url), 'utf8');
    expect(up).toMatch(/UPDATE "auth_session" SET "ip_address" = NULL/);
    await t.client.query("INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES ('us1', 'N', 'n@ln.test', true, now(), now())");
    await t.client.query("INSERT INTO auth_session (id, expires_at, token, created_at, updated_at, ip_address, user_id) VALUES ('s1', now() + interval '1 hour', 'tok', now(), now(), '203.0.113.7', 'us1')");
    await t.client.query(up.split('\n').filter((l) => !l.startsWith('--')).join('\n'));
    const s = (await t.client.query<{ ip_address: string | null; n: number }>("SELECT ip_address, (SELECT count(*)::int FROM auth_session) n FROM auth_session WHERE id = 's1'")).rows[0]!;
    expect(s.ip_address).toBeNull();
    expect(s.n).toBe(1);
    const down = readFileSync(new URL('../../../packages/db/drizzle/down/0033_audit_log_ip_anulavel.down.sql', import.meta.url), 'utf8');
    expect(down).toMatch(/ln_reject_mutation/);
  });
});

describe('job', () => {
  it('startAuditIpRetention roda na subida, reporta só a contagem, não derruba em erro e para', async () => {
    await put('j1', dias(500), HASH('f'));
    const out: number[] = [];
    const w = startAuditIpRetention({ db: db(), intervalMs: 3_600_000, now: () => NOW, onResult: (n) => out.push(n) });
    await new Promise((r) => setTimeout(r, 1500));
    expect(out[0]).toBe(1);
    w.stop();
    const erros: unknown[] = [];
    const w2 = startAuditIpRetention({ db: { execute: () => Promise.reject(new Error('pg fora')) } as unknown as Db, intervalMs: 3_600_000, onError: (e) => erros.push(e) });
    await new Promise((r) => setTimeout(r, 300));
    w2.stop();
    expect(erros).toHaveLength(1);
  });
});
