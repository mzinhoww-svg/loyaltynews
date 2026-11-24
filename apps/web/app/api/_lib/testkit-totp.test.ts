import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { call, makeApp } from './testkit';
import * as materias from '../materias/route';

// O helper actor() gera e verifica o TOTP com o relógio (só Date) parado entre os dois passos: nunca cai na virada da janela de 30 s.
let app: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  app = await makeApp();
}, 120_000);
afterAll(async () => app.close());

describe('testkit: TOTP determinístico', () => {
  it('cria a sessão com MFA e devolve o relógio real (sem deixar relógio falso ligado)', async () => {
    const a = await app.actor('editor');
    expect(a.cookie).not.toBe('');
    expect(vi.isFakeTimers()).toBe(false);
    expect((await call(materias.GET, 'GET', { as: a })).status).toBe(200);
  });

  it('na virada da janela (relógio falso a 1 ms do fim dos 30 s) o login com MFA continua valendo', async () => {
    const fim = Math.ceil(Date.now() / 30_000) * 30_000 + 30_000;
    vi.useFakeTimers({ toFake: ['Date'], now: fim - 1 });
    try {
      const a = await app.actor('revisor');
      expect((await call(materias.GET, 'GET', { as: a })).status).toBe(200);
      expect(vi.isFakeTimers()).toBe(true); // o relógio falso do próprio teste é mantido
    } finally {
      vi.useRealTimers();
    }
  });
});
