import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import journal from '@ln/db/journal';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { journalCount, migrationProbe, readiness, resetMigrationCacheForTest } from '../_lib/ready';

// /api/ready confere as migrações: linhas em drizzle.__drizzle_migrations == entradas do journal embarcado no build. Uma consulta, cache de 30 s.
let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
const N = journalCount(journal);
const ok = async () => undefined;
const ENV = { DB_SSL_MODE: 'disable', REDIS_URL: 'redis://redis.invalid:6379' };

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(async () => t.close());
beforeEach(() => resetMigrationCacheForTest());

describe('/api/ready: migrações', () => {
  it('o journal embarcado tem as migrações do pacote (inclui a 0025)', () => {
    expect(N).toBeGreaterThanOrEqual(26);
  });

  it('banco migrado e journal igual: 200 com migracoes:"ok"', async () => {
    expect(await migrationProbe(db, N)()).toBe('ok');
    const r = await readiness(ENV, { db: ok, redis: ok, migrations: migrationProbe(db, N) });
    expect(r).toMatchObject({ status: 'ok', migracoes: 'ok' });
    expect(r).not.toHaveProperty('motivo');
  });

  it('journal a mais (build novo, banco sem a última migração): 503 migracoes_pendentes, sem nome de tabela nem SQL', async () => {
    const r = await readiness(ENV, { db: ok, redis: ok, migrations: migrationProbe(db, N + 1) });
    expect(r.status).toBe('indisponivel');
    expect(r.motivo).toBe('migracoes_pendentes');
    expect(r).not.toHaveProperty('migracoes');
    const txt = JSON.stringify(r);
    for (const s of ['drizzle', '__drizzle_migrations', 'select', 'titular', 'count']) expect(txt.toLowerCase()).not.toContain(s);
  });

  it('journal a menos (banco à frente do build): 503 migracoes_divergentes', async () => {
    const r = await readiness(ENV, { db: ok, redis: ok, migrations: migrationProbe(db, N - 1) });
    expect(r).toMatchObject({ status: 'indisponivel', motivo: 'migracoes_divergentes' });
  });

  it('banco sem a tabela de migrações (nada aplicado): pendentes; outro erro: falha; banco fora: nem consulta', async () => {
    const semTabela = { execute: async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); } } as unknown as Db;
    expect(await migrationProbe(semTabela, N)()).toBe('pendentes');
    resetMigrationCacheForTest();
    const quebrado = { execute: async () => { throw Object.assign(new Error('x'), { code: '08006' }); } } as unknown as Db;
    const r = await readiness(ENV, { db: ok, redis: ok, migrations: migrationProbe(quebrado, N) });
    expect(r).toMatchObject({ status: 'indisponivel', motivo: 'migracoes_falha' });
    let chamou = false;
    const r2 = await readiness(ENV, { db: async () => { throw new Error('down'); }, redis: ok, migrations: async () => { chamou = true; return 'ok'; } });
    expect(chamou).toBe(false);
    expect(r2.status).toBe('indisponivel');
    expect(r2).not.toHaveProperty('motivo');
  });

  it('cache de 30 s: uma consulta só dentro da janela; depois consulta de novo', async () => {
    let n = 0;
    let clock = 1_000_000;
    const contado = { execute: async () => { n++; return { rows: [{ n: N }] }; } } as unknown as Db;
    const p = migrationProbe(contado, N, () => clock);
    expect(await p()).toBe('ok');
    clock += 29_000;
    expect(await p()).toBe('ok');
    expect(n).toBe(1);
    clock += 2_000;
    expect(await p()).toBe('ok');
    expect(n).toBe(2);
  });
});

describe('/api/ready: prazo da sonda de migrações', () => {
  it('consulta que não responde: expira em PROBE_TIMEOUT_MS e devolve 503 migracoes_falha (sem pendurar o healthcheck)', async () => {
    const { vi } = await import('vitest');
    const { PROBE_TIMEOUT_MS } = await import('../_lib/ready');
    vi.useFakeTimers();
    try {
      const pendurado = { execute: () => new Promise(() => undefined) } as unknown as Db;
      const p = readiness(ENV, { db: ok, redis: ok, migrations: migrationProbe(pendurado, N) });
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
      const r = await p;
      expect(r).toMatchObject({ status: 'indisponivel', motivo: 'migracoes_falha' });
      expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('/api/ready: resposta tardia não grava o cache (ajuste do QA 6)', () => {
  it('1ª consulta expira e termina tarde com a contagem antiga; a 2ª (mais nova) vale; a 3ª consulta de novo ou usa só o resultado no prazo', async () => {
    const { vi } = await import('vitest');
    const { PROBE_TIMEOUT_MS } = await import('../_lib/ready');
    vi.useFakeTimers();
    try {
      let clock = 5_000_000;
      const nowFn = () => clock;
      let liberarAntiga: (v: unknown) => void = () => undefined;
      let chamadas = 0;
      const fake = {
        execute: () => {
          chamadas++;
          if (chamadas === 1) return new Promise((res) => { liberarAntiga = res; }); // pendurada; termina tarde com N (ok)
          return Promise.resolve({ rows: [{ n: N - 1 }] }); // estado atual: falta uma migração
        },
      } as unknown as Db;
      const probe = migrationProbe(fake, N, nowFn);
      // 1ª: expira no handler
      const r1p = readiness(ENV, { db: ok, redis: ok, migrations: probe });
      clock += PROBE_TIMEOUT_MS + 1;
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
      expect(await r1p).toMatchObject({ motivo: 'migracoes_falha' });
      // 2ª: consulta nova, no prazo: pendentes (grava o cache)
      expect(await readiness(ENV, { db: ok, redis: ok, migrations: probe })).toMatchObject({ status: 'indisponivel', motivo: 'migracoes_pendentes' });
      // a 1ª termina agora, tarde, com a contagem antiga (N = ok): NÃO pode sobrescrever
      liberarAntiga({ rows: [{ n: N }] });
      await vi.advanceTimersByTimeAsync(0);
      // 3ª: dentro dos 30 s, usa o cache da 2ª (pendentes), nunca o "ok" tardio
      const r3 = await readiness(ENV, { db: ok, redis: ok, migrations: probe });
      expect(r3).toMatchObject({ status: 'indisponivel', motivo: 'migracoes_pendentes' });
      expect(chamadas).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('consulta única que termina depois do prazo não grava cache: a próxima chamada consulta de novo', async () => {
    let clock = 9_000_000;
    let n = 0;
    const { PROBE_TIMEOUT_MS } = await import('../_lib/ready');
    const lenta = { execute: async () => { n++; clock += PROBE_TIMEOUT_MS + 10; return { rows: [{ n: N }] }; } } as unknown as Db;
    const p = migrationProbe(lenta, N, () => clock);
    await p();
    await p();
    expect(n).toBe(2);
  });

  it('com transação (PGlite): limita a consulta no banco e ainda responde ok', async () => {
    expect(await migrationProbe(db, N)()).toBe('ok');
  });
});
