// Concorrência REAL entre processos no PostgreSQL: vários pools (cada um é uma conexão/"processo" distinto) reservando ao mesmo tempo
// no MESMO ledger canônico (budget_*, ADR-020). Só roda com LN_TEST_REAL_TLS=1 (mesmas variáveis de packages/db/src/tls.real.test.ts). Cria um banco próprio e o apaga.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { pgPoolConfig } from '@ln/db/tls';
import { runMigrations } from '@ln/db/migrate';
import { assertLocalTestHost } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { BudgetGate, PostgresLedgerStore, gateConfigFromPolicy, loadPolicyFile, type SqlDatabase } from '@ln/modelops';

const dir = process.env.LN_TEST_CERTS_DIR;
const url = process.env.LN_TEST_PG_URL;
const real = process.env.LN_TEST_REAL_TLS === '1' && !!dir && !!url;
const file = (n: string) => readFileSync(join(dir!, n), 'utf8');
const policy = loadPolicyFile(fileURLToPath(new URL('../../../packages/modelops/fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy!;
const cfg = gateConfigFromPolicy(policy);
const NOW = new Date('2026-11-23T12:00:00-03:00');
const DBNAME = `ln_budget_real_${Date.now()}`;

describe.skipIf(!real)('ledger de orçamento em PostgreSQL real, com instâncias concorrentes', () => {
  const tls = () => ({ DB_SSL_CA_PEM: file('ca.crt'), DB_SSL_CERT_PEM: file('client.crt'), DB_SSL_KEY_PEM: file('client.pk8.key'), NODE_ENV: 'production' });
  const envFor = (db: string) => ({ ...tls(), DATABASE_URL: url!.replace(/\/[^/]*$/, `/${db}`) });
  const pools: pg.Pool[] = [];
  let admin: pg.Pool;
  const gateOn = (db: string) => {
    const pool = new pg.Pool(pgPoolConfig(envFor(db), { max: 6 }));
    pools.push(pool);
    const d = drizzle(pool, { schema }) as unknown as Db;
    return { gate: new BudgetGate(cfg, new PostgresLedgerStore(d as unknown as SqlDatabase)), db: d };
  };
  const req = (over: Record<string, unknown> = {}) =>
    ({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'anthropic/claude-sonnet-5.5', escalation: false, amountUsd: 1, at: NOW, ...over }) as never;

  beforeAll(async () => {
    assertLocalTestHost(url!, 'LN_TEST_PG_URL'); // este teste cria e apaga um banco: só em PostgreSQL local
    admin = new pg.Pool(pgPoolConfig({ ...tls(), DATABASE_URL: url! }, { max: 1 }));
    await admin.query(`create database ${DBNAME}`);
    await runMigrations(envFor(DBNAME));
  }, 120_000);
  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
    await admin?.query(`drop database if exists ${DBNAME} with (force)`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  }, 60_000);

  it('4 instâncias com conexões distintas e 120 reservas simultâneas numa verba de 22: exatamente 22 passam e o seq é contíguo', async () => {
    const gates = [gateOn(DBNAME), gateOn(DBNAME), gateOn(DBNAME), gateOn(DBNAME)];
    const results = await Promise.all(Array.from({ length: 120 }, (_, i) => gates[i % 4]!.gate.reserve(req())));
    expect(results.filter((r) => r.ok).length).toBe(22);
    const ids = (await new PostgresLedgerStore(gates[0]!.db as unknown as SqlDatabase).readAll()).filter((e) => e.type === 'reserve').map((e) => e.reservationId);
    expect(new Set(ids).size).toBe(22); // ids de reserva únicos entre as 4 conexões (sem r-1 repetido)
    expect((await gates[1]!.gate.snapshot(NOW)).providerMicro.anthropic).toBe(22_000_000);
  }, 120_000);

  it('reservas de 8 de 8 do defeito original: 8 x US$ 5 em 2 conexões contra a verba de 22 ⇒ 4 aceitas e ids únicos', async () => {
    const fresh = `${DBNAME}_b`;
    await admin.query(`create database ${fresh}`);
    await runMigrations(envFor(fresh));
    const gates = [gateOn(fresh), gateOn(fresh)];
    const r = await Promise.all(Array.from({ length: 8 }, (_, i) => gates[i % 2]!.gate.reserve(req({ amountUsd: 5 }))));
    expect(r.filter((x) => x.ok).length).toBe(4);
    const ids = r.filter((x) => x.ok).map((x) => (x as { reservationId: string }).reservationId);
    expect(new Set(ids).size).toBe(4);
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
    pools.length = 0;
    await admin.query(`drop database if exists ${fresh} with (force)`);
  }, 120_000);

  it('mistura openai + anthropic em 4 instâncias nunca passa de 42 fora da reserva; "reinício" vê o mesmo estado', async () => {
    const gates = [gateOn(DBNAME), gateOn(DBNAME), gateOn(DBNAME)];
    const jobs = Array.from({ length: 90 }, (_, i) => gates[i % 3]!.gate.reserve(req({ provider: 'openai', model: 'openai/gpt-6.1-terra' })));
    const results = await Promise.all(jobs);
    expect(results.filter((r) => r.ok).length).toBe(20); // openai: verba de 20
    const fresh = gateOn(DBNAME); // novo "processo"
    const snap = await fresh.gate.snapshot(NOW);
    expect(snap.totalMicro).toBe(42_000_000);
    expect(snap.reserveMicro).toBe(0);
  }, 120_000);

  it('o escritor da parada usa a MESMA trava das reservas: com uma operação do ledger em curso, setKill espera; depois dela, vale', async () => {
    const fresh = `${DBNAME}_lock`;
    await admin.query(`create database ${fresh}`);
    await runMigrations(envFor(fresh));
    const a = gateOn(fresh);
    const holder = new pg.Pool(pgPoolConfig(envFor(fresh), { max: 1 }));
    pools.push(holder);
    const c = await holder.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('ln_modelops_budget'))`); // uma operação do ledger "em curso"
      let feito = false;
      const escrita = a.gate.setKill('global', true, 'parada durante operação em curso', NOW).then(() => { feito = true; });
      await new Promise((r) => setTimeout(r, 600));
      expect(feito).toBe(false); // esperou a trava
      await c.query('COMMIT');
      await escrita;
      expect(feito).toBe(true);
      expect(await a.gate.killState()).toMatchObject({ global: true });
      // e a auditoria falhando desfaz a parada, também no PostgreSQL real
      await a.gate.setKill('global', false, 'volta ao normal', NOW);
      const store = new PostgresLedgerStore(a.db as unknown as SqlDatabase);
      await expect(store.setKillWith('global', true, 'parada com auditoria que falha', NOW, async () => { throw new Error('auditoria indisponível'); })).rejects.toThrow('auditoria indisponível');
      expect(await a.gate.killState()).toMatchObject({ global: false });
    } finally {
      c.release();
      await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
      pools.length = 0;
      await admin.query(`drop database if exists ${fresh} with (force)`);
    }
  }, 120_000);

  it('kill switch acionado por uma instância vale para as outras na hora', async () => {
    const a = gateOn(DBNAME);
    const b = gateOn(DBNAME);
    await a.gate.setKill('global', true, 'teste de parada real', NOW, 'u1');
    expect(await b.gate.reserve(req({ taskId: 'wf08_correction', taskClass: 'reserve', amountUsd: 1 }))).toMatchObject({ ok: false, reason: 'kill_switch' });
    await a.gate.setKill('global', false, 'fim do teste real', NOW, 'u1');
    expect((await b.gate.reserve(req({ taskId: 'wf08_correction', taskClass: 'reserve', amountUsd: 1 }))).ok).toBe(true);
  }, 60_000);
});
