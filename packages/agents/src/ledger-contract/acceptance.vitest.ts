/**
 * Wrapper do vitest para a suíte de aceitação do ledger. O Backend usa assim, no teste do `PgLedgerStore`:
 *
 *   defineLedgerAcceptance('PgLedgerStore (PGlite)', async () => {
 *     const db = await createTestDb();            // migração com a tabela de eventos
 *     return { a: new PgLedgerStore(db), b: () => new PgLedgerStore(db), tamper: (k) => rawSql(db, k), policy };
 *   });
 */
import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_CASES, type AcceptanceHarness } from './acceptance';

export function defineLedgerAcceptance(name: string, makeHarness: () => Promise<AcceptanceHarness>): void {
  describe(`ledger persistente — aceitação G4: ${name}`, () => {
    for (const c of ACCEPTANCE_CASES) {
      it(`${c.id}: ${c.title}`, async () => {
        const r = await c.run(await makeHarness());
        // "skipped" só é aceitável para o que depende de recurso opcional (tamper/policy); fica visível no relatório
        expect(r === undefined || r === 'skipped').toBe(true);
      });
    }
  });
}
