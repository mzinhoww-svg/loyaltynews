import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../migrate';
import { addEvidence } from '../repo';
import type { Db } from '../db';
import type { IntelligenceConfig } from '../config';
import { resolveOrCreatePerson } from '../repo';
import { processObservation } from '../moves';
import { ingestBatch } from '../ingest';
import { mockEvidence } from '../../fixtures/mock-entities';

export async function newDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite(); // PostgreSQL real em memória (WASM); sem rede, sem serviço externo
  await applyMigrations((sql) => pg.exec(sql));
  return { db: pg as unknown as Db, pg };
}

export const ev = (db: Db, slug: string, at?: string) => addEvidence(db, mockEvidence(slug, at));

/** Ingestão de pessoas LIGADA só nos testes (o default de produção é desligado). */
export const CFG_ON: IntelligenceConfig = { personIngestion: true, extendedPersonalData: false };
export const rp = (db: Db, p: Parameters<typeof resolveOrCreatePerson>[1], cfg: IntelligenceConfig = CFG_ON) => resolveOrCreatePerson(db, p, cfg);
export const po = (db: Db, o: Parameters<typeof processObservation>[1], cfg: IntelligenceConfig = CFG_ON) => processObservation(db, o, cfg);
export const ib = (db: Db, b: unknown, cfg: IntelligenceConfig = CFG_ON) => ingestBatch(db, b, cfg);
