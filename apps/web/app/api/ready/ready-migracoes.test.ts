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
