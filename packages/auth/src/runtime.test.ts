import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntime, setRuntimeForTest } from './runtime';

const SECRET = 'k'.repeat(40);
afterEach(() => {
  setRuntimeForTest(undefined);
  vi.restoreAllMocks();
});

describe('getRuntime (banco por TLS)', () => {
  it('sem DATABASE_URL ou com segredo curto: null, como antes (rotas negam), e sem tocar em TLS', () => {
    expect(getRuntime({})).toBeNull();
    setRuntimeForTest(undefined);
    expect(getRuntime({ DATABASE_URL: 'postgres://u:p@h/db', BETTER_AUTH_SECRET: 'curto' })).toBeNull();
    setRuntimeForTest(undefined);
    expect(getRuntime({ BETTER_AUTH_SECRET: SECRET })).toBeNull();
  });

  it('produção com DATABASE_URL e sem os PEM: null (rotas negam) e o log não traz URL, senha nem PEM', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(getRuntime({ DATABASE_URL: 'postgres://usuario:SENHA-SECRETA@h/db', BETTER_AUTH_SECRET: SECRET, NODE_ENV: 'production' })).toBeNull();
    const logged = err.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/DB_SSL_CA_PEM/);
    expect(logged).not.toContain('SENHA-SECRETA');
    expect(logged).not.toContain('usuario');
  });

  it('PEM inválido: null e log sem o conteúdo; o resultado fica em cache (não repete a tentativa)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = { DATABASE_URL: 'postgres://u:p@h/db', BETTER_AUTH_SECRET: SECRET, DB_SSL_CA_PEM: 'SEGREDO-NAO-PEM', DB_SSL_CERT_PEM: 'x', DB_SSL_KEY_PEM: 'y' };
    expect(getRuntime(env)).toBeNull();
    expect(getRuntime(env)).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls.join(' ')).not.toContain('SEGREDO-NAO-PEM');
  });

  it('com TLS válido monta o runtime (o Pool só conecta no primeiro uso)', () => {
    const pem = (t: string) => `-----BEGIN ${t}-----\nQUFB\n-----END ${t}-----\n`;
    const rt = getRuntime({
      DATABASE_URL: 'postgres://u:p@h/db', BETTER_AUTH_SECRET: SECRET, DB_SSL_CA_PEM: pem('CERTIFICATE'), DB_SSL_CERT_PEM: pem('CERTIFICATE'), DB_SSL_KEY_PEM: pem('PRIVATE KEY'),
    });
    expect(rt).not.toBeNull();
    expect(typeof rt!.handle).toBe('function');
  });
});
