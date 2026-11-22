import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pkg from '../src/index.ts';

test('a entrada pública expõe os pontos principais do gateway', () => {
  for (const name of ['validatePolicy', 'BudgetGate', 'MemoryLedgerStore', 'route', 'callModel', 'selectClient', 'monthKey', 'usdToMicro']) {
    assert.equal(typeof (pkg as Record<string, unknown>)[name], 'function', `export ausente: ${name}`);
  }
  assert.equal(pkg.MICRO_PER_USD, 1_000_000);
  assert.ok(pkg.TASK_CATALOG['fact_check']);
});
