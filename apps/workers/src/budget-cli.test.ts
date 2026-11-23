import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { run } from './budget-cli';

// CLI do kill switch (sem agente e sem a web): validação de argumentos e falha fechada de TLS, sem vazar segredo.
describe('budget-cli', () => {
  it('uso incorreto e motivo/ator ausentes saem com 2, sem tocar no banco', async () => {
    const out: string[] = [];
    expect(await run(['nada'], {}, (s) => out.push(s))).toBe(2);
    expect(await run(['kill', 'on'], { DATABASE_URL: 'postgres://u:p@h/db' }, (s) => out.push(s))).toBe(2);
    expect(await run(['kill', 'on', 'abc', '--actor', 'u1'], { DATABASE_URL: 'postgres://u:p@h/db' }, (s) => out.push(s))).toBe(2);
    expect(await run(['kill', 'off', 'motivo suficiente'], { DATABASE_URL: 'postgres://u:p@h/db' }, (s) => out.push(s))).toBe(2); // sem --actor
    expect(out.join('\n')).toMatch(/uso:|motivo/);
  });

  it('produção sem os PEM de TLS falha fechada, nomeando só as variáveis (nunca a senha da URL)', async () => {
    const env = { DATABASE_URL: 'postgres://u:SENHA-SECRETA@h/db', NODE_ENV: 'production' };
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
});

