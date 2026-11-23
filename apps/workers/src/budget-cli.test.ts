import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import policyRaw from '@ln/modelops/policy';
import { BudgetGate, PostgresLedgerStore, gateConfigFromPolicy, monthKey, validatePolicy, type SqlDatabase } from '@ln/modelops';
import { run } from './budget-cli';

// CLI do kill switch (sem agente e sem a web): validação de argumentos e falha fechada de TLS, sem vazar segredo.
describe('budget-cli', () => {
  it('uso incorreto e motivo/ator ausentes saem com 2, sem tocar no banco', async () => {
    const out: string[] = [];
    expect(await run(['nada'], {}, (s) => out.push(s))).toBe(2);
    expect(await run(['kill', 'on'], { DATABASE_URL: 'postgres:' + '//u:p@h/db' }, (s) => out.push(s))).toBe(2);
    expect(await run(['kill', 'on', 'abc', '--actor', 'u1'], { DATABASE_URL: 'postgres:' + '//u:p@h/db' }, (s) => out.push(s))).toBe(2);
    expect(await run(['kill', 'off', 'motivo suficiente'], { DATABASE_URL: 'postgres:' + '//u:p@h/db' }, (s) => out.push(s))).toBe(2); // sem --actor
    expect(out.join('\n')).toMatch(/uso:|motivo/);
  });

  it('produção sem os PEM de TLS falha fechada, nomeando só as variáveis (nunca a senha da URL)', async () => {
    const env = { DATABASE_URL: 'postgres:' + '//u:SENHA-SECRETA@h/db', NODE_ENV: 'production' };
    let msg = '';
    try {
      await run(['status'], env, () => undefined);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/DB_SSL_CA_PEM/);
    expect(msg).not.toContain('SENHA-SECRETA');
  });

  it('kill on/off grava a parada E o autor no audit_log (mesma transação); status devolve o estado', async () => {
    const t = await createTestDb();
    try {
      const out: string[] = [];
      expect(await run(['kill', 'on', 'gasto anômalo no provedor', '--actor', 'user-9'], {}, (x) => out.push(x), t.db)).toBe(0);
      expect(JSON.parse(out.at(-1)!)).toEqual({ global: true, routes: [] });
      expect(await run(['kill', 'on', 'rota instável agora', '--route', 'economy', '--actor', 'user-9'], {}, (x) => out.push(x), t.db)).toBe(0);
      expect(JSON.parse(out.at(-1)!)).toEqual({ global: true, routes: ['economy'] });
      expect(await run(['kill', 'off', 'causa corrigida e conferida', '--actor', 'user-9'], {}, (x) => out.push(x), t.db)).toBe(0);
      expect(await run(['status'], {}, (x) => out.push(x), t.db)).toBe(0);
      expect(JSON.parse(out.at(-1)!)).toEqual({ global: false, routes: ['economy'] });
      const logs = (await t.db.select().from(schema.auditLog)).filter((l) => l.action.startsWith('orcamento.kill_switch'));
      expect(logs.map((l) => l.action)).toEqual(['orcamento.kill_switch_acionado', 'orcamento.kill_switch_acionado', 'orcamento.kill_switch_desligado']);
      expect(logs[0]).toMatchObject({ actorId: 'user-9', actorRole: 'cli', resourceId: 'global' });
    } finally {
      await t.close();
    }
  });

  it('SONDA: auditoria que falha desfaz a parada e a CLI sai com 1 e mensagem clara', async () => {
    const t = await createTestDb();
    try {
      await t.db.execute(sql`CREATE FUNCTION ln_teste_falha_auditoria() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada da auditoria'; END; $$ LANGUAGE plpgsql`);
      await t.db.execute(sql`CREATE TRIGGER ln_teste_falha_auditoria BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ln_teste_falha_auditoria()`);
      const out: string[] = [];
      expect(await run(['kill', 'on', 'parada com auditoria quebrada', '--actor', 'user-9'], {}, (x) => out.push(x), t.db)).toBe(1);
      expect(out.join('\n')).toMatch(/NÃO foi alterada/);
      expect(await t.db.$count(schema.budgetKillSwitch)).toBe(0);
    } finally {
      await t.close();
    }
  });
  // G4.2: `reconcile AAAA-MM` confere o ledger com /generation (só leitura); sai 0 só se o mês FECHA.
  describe('reconcile', () => {
    const mes = monthKey(new Date());
    const geracao = (custo: number) => (async () => new Response(JSON.stringify({ data: { id: 'g1', total_cost: custo } }))) as unknown as typeof fetch;
    async function comUmaCobranca(custo: number) {
      const t = await createTestDb();
      const p = validatePolicy(policyRaw).policy!;
      const gate = new BudgetGate(gateConfigFromPolicy(p), new PostgresLedgerStore(t.db as unknown as SqlDatabase));
      const r = await gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 1, at: new Date() });
      if (!r.ok) throw new Error(r.detail);
      await gate.commit(r.reservationId, custo, new Date(), 'g1');
      return t;
    }

    it('argumentos: mês inválido, sem chave e tolerância absurda saem com 2 sem tocar no banco nem na rede', async () => {
      const out: string[] = [];
      const semRede = (() => { throw new Error('rede proibida'); }) as unknown as typeof fetch;
      expect(await run(['reconcile', '2026-13'], { OPENROUTER_API_KEY: 'k' }, (x) => out.push(x), {}, semRede)).toBe(2);
      expect(await run(['reconcile', mes], {}, (x) => out.push(x), {}, semRede)).toBe(2);
      expect(await run(['reconcile', mes, '--tolerance', '50'], { OPENROUTER_API_KEY: 'k' }, (x) => out.push(x), {}, semRede)).toBe(2);
      expect(out.join('\n')).toMatch(/AAAA-MM/);
      expect(out.join('\n')).toMatch(/OPENROUTER_API_KEY/);
    });

    it('ledger igual ao provedor: o mês fecha e a CLI sai com 0', async () => {
      const t = await comUmaCobranca(0.2);
      try {
        const out: string[] = [];
        expect(await run(['reconcile', mes], { OPENROUTER_API_KEY: 'k' }, (x) => out.push(x), t.db, geracao(0.2))).toBe(0);
        expect(out[0]).toContain('FECHADO');
      } finally {
        await t.close();
      }
    });

    it('divergência acima de 1% não fecha: sai com 1 e lista o item divergente (sem imprimir a chave)', async () => {
      const t = await comUmaCobranca(0.2);
      try {
        const out: string[] = [];
        expect(await run(['reconcile', mes], { OPENROUTER_API_KEY: 'sk-segredo' }, (x) => out.push(x), t.db, geracao(0.25))).toBe(1);
        expect(out.join('\n')).toMatch(/NÃO FECHA/);
        expect(out.join('\n')).toMatch(/divergente/);
        expect(out.join('\n')).not.toContain('sk-segredo');
      } finally {
        await t.close();
      }
    });
  });
});

