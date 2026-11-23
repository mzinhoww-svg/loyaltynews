import { describe, expect, it } from 'vitest';
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
});
