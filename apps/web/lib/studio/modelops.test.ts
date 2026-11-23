import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetGate, PostgresLedgerStore, gateConfigFromPolicy, type SqlDatabase } from '@ln/modelops';
import { makeApp } from '../../app/api/_lib/testkit';
import { setDepsForTest } from '../../app/api/_lib/deps';
import { carregarPolitica, getPortao } from './modelops';

// A tela FinOps do Studio lê o ledger PERSISTENTE (PostgreSQL), o mesmo do gateway; sem banco não há fallback em memória.
let app: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  app = await makeApp();
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('getPortao (FinOps no Studio)', () => {
  it('com banco: lê o mesmo ledger do gateway (reserva feita por outro portão aparece; restart não perde)', async () => {
    const pol = carregarPolitica();
    if (!pol.ok) throw new Error(pol.erros.join(' '));
    const p = getPortao(pol.policy);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect((await p.gate.snapshot(app.clock.now)).totalMicro).toBe(0);
    // outro "processo" (outro portão, mesmo banco) reserva
    const outro = new BudgetGate(gateConfigFromPolicy(pol.policy), new PostgresLedgerStore(app.db as unknown as SqlDatabase));
    const r = await outro.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 3, at: app.clock.now });
    expect(r.ok).toBe(true);
    const lido = getPortao(pol.policy); // nova leitura (nenhum estado em memória do Studio)
    if (!lido.ok) throw new Error('portão indisponível');
    const snap = await lido.gate.snapshot(app.clock.now);
    expect(snap.totalMicro).toBe(3_000_000);
    expect(snap.providerMicro.anthropic).toBe(3_000_000);
  });

  it('sem banco configurado: indisponível, SEM fallback em memória e sem zero inventado', () => {
    setDepsForTest(null);
    const old = { ...process.env };
    delete process.env.DATABASE_URL;
    process.env.APP_MODE = 'nodb';
    try {
      const pol = carregarPolitica();
      if (!pol.ok) throw new Error(pol.erros.join(' '));
      const p = getPortao(pol.policy);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.motivo).toMatch(/Banco de dados não configurado/);
    } finally {
      if (old.APP_MODE === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = old.APP_MODE;
    }
  });
});
