import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../src/migrate.ts';
import { addEvidence } from '../src/repo.ts';
import type { Db } from '../src/db.ts';
import { mockEvidence } from '../fixtures/mock-entities.ts';

export async function newDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite(); // PostgreSQL real em memória (WASM); sem rede, sem serviço externo
  await applyMigrations((sql) => pg.exec(sql));
  return { db: pg as unknown as Db, pg };
}

export const ev = (db: Db, slug: string, at?: string) => addEvidence(db, mockEvidence(slug, at));
