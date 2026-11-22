/**
 * Adaptador de `pg.Pool` (ou compatível) para `PgDb`. Transação = BEGIN/COMMIT numa única
 * conexão, ROLLBACK em qualquer erro, conexão sempre devolvida ao pool.
 *
 *   import { Pool } from 'pg';
 *   const store = new PgStore(pgDbFromPool(new Pool({ connectionString: process.env.DATABASE_URL })));
 */
import type { PgDb, PgQueryable } from './pg-store';

export interface PoolClientLike extends PgQueryable {
  release(err?: unknown): void;
}
export interface PoolLike extends PgQueryable {
  connect(): Promise<PoolClientLike>;
}

export function pgDbFromPool(pool: PoolLike): PgDb {
  return {
    query: (sql, params) => pool.query(sql, params),
    async transaction<T>(fn: (q: PgQueryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* conexão já perdida: o erro original é o relevante */
        }
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

export interface PGliteLike extends PgQueryable {
  transaction<T>(fn: (tx: PgQueryable) => Promise<T>): Promise<T>;
}

/** Adaptador para PGlite (PostgreSQL em WASM, usado nos testes do monorepo). */
export function pgDbFromPGlite(client: PGliteLike): PgDb {
  return {
    query: (sql, params) => client.query(sql, params),
    transaction: (fn) => client.transaction(fn),
  };
}
