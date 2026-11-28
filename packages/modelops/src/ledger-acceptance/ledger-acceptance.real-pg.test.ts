// G4 contra PostgreSQL REAL e LOCAL (opt-in): a suíte de aceitação com duas conexões, o estresse de 1.000 reservas e o teste
// com dois PROCESSOS de sistema operacional. NUNCA roda contra o banco de staging: a URL precisa ser de loopback
// (127.0.0.1, localhost, ::1) e o teste cria um banco próprio e o apaga no fim.
//
//   LN_G4_REAL=1 LN_G4_PG_URL=postgres://<usuario>:<senha>@127.0.0.1:PORTA/postgres npx vitest run packages/modelops/src/ledger-acceptance
//
// Como subir um PostgreSQL local descartável: ver packages/modelops/docs/ledger-acceptance.md.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '@ln/db/testing';
import { BudgetGate, gateConfigFromPolicy } from '../budget';
import { PostgresLedgerStore, type SqlDatabase } from '../budget-pg';
import { loadPolicyFile } from '../policy';
import type { ModelPolicy } from '../types';
import { ACCEPTANCE_CASES, runAcceptance, type AcceptanceHarness } from './acceptance';
import { WithLockAtomicAdapter } from './withlock-adapter';

const real = process.env.LN_G4_REAL === '1' && !!process.env.LN_G4_PG_URL && process.env.LN_G4_WORKER !== '1';
const adminUrl = process.env.LN_G4_PG_URL ?? '';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Barreira anti-staging: só banco local. */
export function assertLoopback(url: string): void {
  const host = new URL(url).hostname;
  if (!LOOPBACK.has(host)) throw new Error(`recusado: ${host} não é loopback; este teste nunca roda contra o banco de staging ou compartilhado`);
}

const policy = loadPolicyFile(fileURLToPath(new URL('../../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy;
const cfg = gateConfigFromPolicy(policy);
const DBNAME = `ln_g4_${process.pid}_${Date.now()}`;
const dbUrl = (name: string) => adminUrl.replace(/\/[^/]*$/, `/${name}`);

describe('barreira anti-staging', () => {
  it('só aceita banco em loopback', () => {
    expect(() => assertLoopback('postgres:' + '//u:p@127.0.0.1:5432/x')).not.toThrow();
    expect(() => assertLoopback('postgres:' + '//u:p@localhost/x')).not.toThrow();
    expect(() => assertLoopback('postgres:' + '//u:p@staging.exemplo.internal:5432/x')).toThrow(/não é loopback/);
    expect(() => assertLoopback('postgres:' + '//u:p@10.0.0.7:5432/x')).toThrow(/não é loopback/);
  });
});

describe.skipIf(!real)('G4 em PostgreSQL real e local', () => {
  // A 0037 recusa TRUNCATE no budget_ledger (gatilho *_no_truncate). Em vez de limpar, cada cenário recebe um banco NOVO clonado de
  // um modelo já migrado (CREATE DATABASE ... TEMPLATE), o mesmo padrão de "banco novo por caso" do @ln/db/testing e do teste PGlite.
  const TEMPLATE = `${DBNAME}_tpl`;
  const pools: pg.Pool[] = [];
  const bancos: string[] = [];
  let admin: pg.Pool;
  let seq = 0;
  const poolOn = (name: string, max = 6) => {
    const p = new pg.Pool({ connectionString: dbUrl(name), max });
    pools.push(p);
    return p;
  };
  /** Banco novo e vazio (só o esquema migrado), clonado do modelo. */
  const fresh = async (): Promise<string> => {
    const name = `${DBNAME}_${++seq}`;
    await admin.query(`create database ${name} template ${TEMPLATE}`);
    bancos.push(name);
    return name;
  };
  const storeOn = (p: pg.Pool) => new PostgresLedgerStore(drizzle(p) as unknown as SqlDatabase);
  const at = new Date('2026-12-03T12:00:00Z');
  const input = (amountUsd: number) => ({ taskId: 'daily', taskClass: 'non_essential' as const, lane: 'text' as const, route: 'economy', provider: 'anthropic', model: 'claude-haiku-5-5', escalation: false, amountUsd, at });

  beforeAll(async () => {
    assertLoopback(adminUrl);
    admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`create database ${TEMPLATE}`);
    bancos.push(TEMPLATE);
    const m = new pg.Pool({ connectionString: dbUrl(TEMPLATE), max: 2 });
    try {
      await migrate(drizzle(m), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await m.end(); // CREATE DATABASE ... TEMPLATE exige o modelo sem conexões
    }
  }, 120_000);
  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
    for (const b of bancos.reverse()) await admin?.query(`drop database if exists ${b} with (force)`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  }, 60_000);

  it('o gatilho da 0037 continua ativo: TRUNCATE no budget_ledger é recusado (controle: o teste não o desliga)', async () => {
    const p = poolOn(await fresh(), 1);
    await expect(p.query('TRUNCATE budget_ledger CASCADE')).rejects.toThrow();
  });

  it('versão do servidor é PostgreSQL 18 (alvo do projeto)', async () => {
    const r = await poolOn(await fresh(), 1).query('show server_version_num');
    expect(Number(r.rows[0].server_version_num)).toBeGreaterThanOrEqual(180000);
  });

  it('suíte de aceitação completa (12 obrigatórios) com duas conexões distintas; só o A13 opcional falha', async () => {
    let anteriores: pg.Pool[] = [];
    const harness = async (): Promise<AcceptanceHarness> => {
      // fecha as conexões do cenário anterior para não acumular conexões ociosas (um banco novo por cenário)
      await Promise.all(anteriores.map((x) => x.end().catch(() => undefined)));
      const db = await fresh();
      const p1 = poolOn(db);
      const p2 = poolOn(db);
      anteriores = [p1, p2];
      return {
        a: new WithLockAtomicAdapter(storeOn(p1)),
        b: () => new WithLockAtomicAdapter(storeOn(p2)),
        policy,
        tamper: async (kind) => {
          if (kind === 'update') await p1.query('UPDATE budget_ledger SET delta_microusd = 1 WHERE true');
          else if (kind === 'delete') await p1.query('DELETE FROM budget_ledger WHERE true');
          else await p1.query('DELETE FROM budget_reservations WHERE true');
        },
      };
    };
    const r = await runAcceptance(harness);
    expect(r.filter((x) => !x.optional && x.outcome !== 'passed'), JSON.stringify(r.filter((x) => x.outcome === 'failed'))).toEqual([]);
    expect(r.filter((x) => !x.optional)).toHaveLength(12);
    expect(r.filter((x) => x.optional).map((x) => x.id)).toEqual(['A13_pending_history']);
    expect(ACCEPTANCE_CASES.filter((c) => !c.optional)).toHaveLength(12);
  }, 180_000);

  it('ESTRESSE: 1.000 reservas de US$ 0,05 em 4 conexões contra a verba Anthropic de US$ 22: exatamente 440 aceitas, 0 estouro, ids únicos', async () => {
    const db = await fresh();
    const p = [poolOn(db), poolOn(db), poolOn(db), poolOn(db)];
    const gates = p.map((x) => new BudgetGate(cfg, storeOn(x)));
    const t0 = Date.now();
    const rs = await Promise.all(Array.from({ length: 1000 }, (_, i) => gates[i % gates.length]!.reserve(input(0.05))));
    const ms = Date.now() - t0;
    const ok = rs.flatMap((r) => (r.ok ? [r.reservationId] : []));
    const sum = await p[0]!.query('select coalesce(sum(max_estimated_microusd),0)::bigint as s, count(*)::int as n from budget_reservations');
    expect(ok.length).toBe(440);
    expect(new Set(ok).size).toBe(440);
    expect(Number(sum.rows[0].s)).toBe(22_000_000);
    expect(sum.rows[0].n).toBe(440);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'provider_allocation_exhausted')).toBe(true);
    console.info(`[G4 estresse] 1000 tentativas, ${ok.length} aceitas, ${ms} ms`);
  }, 240_000);

  it('DOIS PROCESSOS DE SO: dois vitest filhos (PIDs distintos), 500 tentativas de US$ 0,05 cada, mesmo ledger: exatamente 440 aceitas no total', async () => {
    const db = await fresh();
    const dir = mkdtempSync(join(tmpdir(), 'ln-g4-'));
    const require_ = createRequire(import.meta.url);
    const vitestMjs = join(require_.resolve('vitest/package.json').replace(/package\.json$/, ''), 'vitest.mjs');
    const worker = fileURLToPath(new URL('./ledger-process.worker.test.ts', import.meta.url));
    const runWorker = (n: number) =>
      new Promise<{ pid: number; attempts: number; accepted: string[]; refused: number; ms: number }>((resolve, reject) => {
        const out = join(dir, `w${n}.json`);
        const child = spawn(process.execPath, [vitestMjs, 'run', worker, '--reporter=dot'], {
          cwd: process.cwd(),
          env: { ...process.env, LN_G4_WORKER: '1', LN_G4_PG_URL: dbUrl(db), LN_G4_WORKER_OUT: out, LN_G4_N: '500', LN_G4_AMOUNT: '0.05', LN_G4_CONNECTIONS: '2' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let log = '';
        child.stdout.on('data', (d) => (log += String(d)));
        child.stderr.on('data', (d) => (log += String(d)));
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code !== 0) return reject(new Error(`trabalhador ${n} saiu com código ${code}:\n${log.slice(-1500)}`));
          try {
            resolve(JSON.parse(readFileSync(out, 'utf8')));
          } catch (e) {
            reject(e);
          }
        });
      });
    try {
      const [w1, w2] = await Promise.all([runWorker(1), runWorker(2)]);
      expect(w1.pid).not.toBe(w2.pid);
      expect(w1.pid).not.toBe(process.pid);
      expect(w2.pid).not.toBe(process.pid);
      const all = [...w1.accepted, ...w2.accepted];
      expect(all.length).toBe(440);
      expect(new Set(all).size).toBe(440);
      const sum = await poolOn(db, 1).query('select coalesce(sum(max_estimated_microusd),0)::bigint as s, count(*)::int as n from budget_reservations');
      expect(Number(sum.rows[0].s)).toBe(22_000_000);
      expect(sum.rows[0].n).toBe(440);
      console.info(`[G4 dois processos] pids ${w1.pid} e ${w2.pid}: aceitas ${w1.accepted.length} + ${w2.accepted.length} = ${all.length}; ${w1.ms} ms e ${w2.ms} ms`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
