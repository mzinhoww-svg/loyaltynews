// TRABALHADOR do teste com dois PROCESSOS de sistema operacional (ledger-acceptance.real-pg.test.ts). Não é um teste
// do `npm test`: só roda quando o orquestrador o dispara com LN_G4_WORKER=1, num processo próprio, e escreve o
// resultado em LN_G4_WORKER_OUT. Cada processo abre as próprias conexões ao PostgreSQL local e reserva pelo BudgetGate real.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { BudgetGate, gateConfigFromPolicy } from '../budget';
import { PostgresLedgerStore, type SqlDatabase } from '../budget-pg';
import { loadPolicyFile } from '../policy';
import type { ModelPolicy } from '../types';

const active = process.env.LN_G4_WORKER === '1';
const url = process.env.LN_G4_PG_URL ?? '';
const out = process.env.LN_G4_WORKER_OUT ?? '';
const attempts = Number(process.env.LN_G4_N ?? '0');
const amountUsd = Number(process.env.LN_G4_AMOUNT ?? '0');
const connections = Number(process.env.LN_G4_CONNECTIONS ?? '2');
const policy = loadPolicyFile(fileURLToPath(new URL('../../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy;

describe.skipIf(!active)('trabalhador do teste de dois processos (G4)', () => {
  it('reserva N vezes pelo BudgetGate real e grava o resultado', async () => {
    const pools = Array.from({ length: connections }, () => new pg.Pool({ connectionString: url, max: 4 }));
    const gates = pools.map((p) => new BudgetGate(gateConfigFromPolicy(policy), new PostgresLedgerStore(drizzle(p) as unknown as SqlDatabase)));
    const at = new Date('2026-12-03T12:00:00Z');
    const input = { taskId: 'daily', taskClass: 'non_essential' as const, lane: 'text' as const, route: 'economy', provider: 'anthropic', model: 'claude-haiku-5-5', escalation: false, amountUsd, at };
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: attempts }, (_, i) => gates[i % gates.length]!.reserve(input)));
    const accepted = results.flatMap((r) => (r.ok ? [r.reservationId] : []));
    writeFileSync(out, JSON.stringify({ pid: process.pid, attempts, accepted, refused: results.length - accepted.length, ms: Date.now() - started }));
    await Promise.all(pools.map((p) => p.end()));
    expect(accepted.length + (results.length - accepted.length)).toBe(attempts);
  }, 240_000);
});
