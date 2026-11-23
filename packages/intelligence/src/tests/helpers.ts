import { PGlite } from '@electric-sql/pglite';
import { vi } from 'vitest';
import { afterEach } from 'vitest';
import { createTestDb, isRealTestDb } from '@ln/db/testing';
import { addEvidence } from '../repo';
import type { Db } from '../db';
import type { IntelligenceConfig } from '../config';
import { resolveOrCreatePerson } from '../repo';
import { processObservation } from '../moves';
import { ingestBatch } from '../ingest';
import { mockEvidence } from '../../fixtures/mock-entities';

// Máquinas ocupadas (CI/outros agentes) estouram o limite padrão de 30 s/10 s: PGlite sobe um PostgreSQL por teste.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

// As migrações OFICIAIS são as do @ln/db (0006_intelligence); aqui só se aplica via createTestDb (nunca packages/intelligence/migrations).
// Migra uma vez por arquivo de teste e reaproveita o banco pronto (dump) em cada teste: bem mais rápido que migrar de novo.
let template: Blob | File | undefined;
// Modo PostgreSQL real (LN_TEST_PG_URL): cada teste ganha um banco clonado do modelo e o apaga no fim.
const abertos: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (abertos.length) await abertos.pop()!();
});
export async function newDb(): Promise<{ db: Db; pg: PGlite }> {
  if (isRealTestDb()) {
    const t = await createTestDb();
    abertos.push(t.close);
    return { db: t.client as unknown as Db, pg: t.client as unknown as PGlite };
  }
  if (!template) {
    const base = await createTestDb(); // PostgreSQL real em memória (WASM); sem rede, sem serviço externo
    template = await base.client.dumpDataDir('none');
    await base.close();
  }
  const pg = new PGlite({ loadDataDir: template });
  await pg.waitReady;
  return { db: pg as unknown as Db, pg };
}

export const ev = (db: Db, slug: string, at?: string) => addEvidence(db, mockEvidence(slug, at));

/** Ingestão de pessoas LIGADA só nos testes (o default de produção é desligado). */
export const CFG_ON: IntelligenceConfig = { personIngestion: true, extendedPersonalData: false };
export const rp = (db: Db, p: Parameters<typeof resolveOrCreatePerson>[1], cfg: IntelligenceConfig = CFG_ON) => resolveOrCreatePerson(db, p, cfg);
export const po = (db: Db, o: Parameters<typeof processObservation>[1], cfg: IntelligenceConfig = CFG_ON) => processObservation(db, o, cfg);
export const ib = (db: Db, b: unknown, cfg: IntelligenceConfig = CFG_ON) => ingestBatch(db, b, cfg);
