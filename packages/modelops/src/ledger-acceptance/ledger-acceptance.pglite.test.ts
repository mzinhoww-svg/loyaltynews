// Suíte de aceitação do ledger (G4) sobre o PostgresLedgerStore, com PGlite (PostgreSQL em WASM) e as migrações oficiais
// de @ln/db. Roda sempre no `npm test`. PGlite é de um processo só: prova a lógica e as restrições do banco; a
// concorrência real entre conexões e processos fica em ledger-acceptance.real-pg.test.ts (PostgreSQL local, opt-in).
import { fileURLToPath } from 'node:url';
import { createTestDb } from '@ln/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresLedgerStore, type SqlDatabase } from '../budget-pg';
import { loadPolicyFile } from '../policy';
import type { ModelPolicy } from '../types';
import { ACCEPTANCE_CASES, runAcceptance, type AcceptanceHarness } from './acceptance';
import { WithLockAtomicAdapter } from './withlock-adapter';

const policy = loadPolicyFile(fileURLToPath(new URL('../../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy;

let t: Awaited<ReturnType<typeof createTestDb>>;
const mk = () => new WithLockAtomicAdapter(new PostgresLedgerStore(t.db as unknown as SqlDatabase));

beforeAll(async () => {
  t = await createTestDb();
}, 120_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.client.exec('TRUNCATE budget_ledger, budget_reservations, budget_refill_fees, budget_kill_switch CASCADE');
});

const harness = async (): Promise<AcceptanceHarness> => {
  await t.client.exec('TRUNCATE budget_ledger, budget_reservations, budget_refill_fees, budget_kill_switch CASCADE');
  return {
    a: mk(),
    b: () => mk(),
    policy,
    tamper: async (kind) => {
      if (kind === 'update') await t.client.query('UPDATE budget_ledger SET delta_microusd = 1 WHERE true');
      else if (kind === 'delete') await t.client.query('DELETE FROM budget_ledger WHERE true');
      else await t.client.query('DELETE FROM budget_reservations WHERE true');
    },
  };
};

describe('ledger persistente — aceitação G4 sobre PostgresLedgerStore (PGlite)', () => {
  for (const c of ACCEPTANCE_CASES) {
    it(`${c.id}: ${c.title}${c.optional ? ' (opcional: depende do desenho)' : ''}`, async () => {
      if (c.optional) {
        await c.run(await harness()).catch(() => undefined);
        return;
      }
      const r = await c.run(await harness());
      expect(r, 'nenhum caso obrigatório pode ficar "skipped" aqui').toBeUndefined();
    });
  }

  it('relatório: 12 obrigatórios passam; o opcional A13 (histórico de pendência) é a limitação aceita do desenho por estado (ADR-020)', async () => {
    const r = await runAcceptance(harness);
    expect(r.filter((x) => !x.optional && x.outcome !== 'passed')).toEqual([]);
    expect(r.filter((x) => x.optional).map((x) => [x.id, x.outcome])).toEqual([['A13_pending_history', 'failed']]);
    expect(r.filter((x) => !x.optional)).toHaveLength(12);
  });
});
