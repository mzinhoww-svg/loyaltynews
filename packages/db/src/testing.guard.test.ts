import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertLocalTestHost } from './testing';

// Guardas do modo PostgreSQL/Redis real dos testes: host local obrigatório (o modo real cria e apaga bancos) e aviso quando só metade
// das variáveis está definida (a suíte cairia em PGlite sem ninguém perceber).
describe('assertLocalTestHost', () => {
  afterEach(() => {
    delete process.env.LN_TEST_ALLOW_REMOTE;
  });

  it('aceita host local (IPv4, IPv6, localhost, qualquer caixa); recusa o resto com mensagem clara', () => {
    for (const u of ['postgres://u:p@127.0.0.1:55432/postgres', 'redis://localhost:6379', 'redis://[::1]:6379', 'postgres://u@LOCALHOST/db']) expect(() => assertLocalTestHost(u, 'X')).not.toThrow();
    for (const u of ['postgres://u:p@db.staging.vertra.example:5432/ln', 'redis://10.0.0.5:6379', 'postgres://u:p@127.0.0.1.evil.example/db', 'redis://127.0.0.2:6379']) {
      expect(() => assertLocalTestHost(u, 'LN_TEST_PG_URL'), u).toThrow(/não é local/);
    }
    expect(() => assertLocalTestHost('não é url', 'LN_TEST_PG_URL')).toThrow(/URL válida/);
  });

  it('a mensagem de recusa não vaza usuário nem senha', () => {
    try {
      assertLocalTestHost('postgres://usuario:SENHA-SECRETA@host.remoto.example/db', 'LN_TEST_PG_URL');
    } catch (e) {
      expect((e as Error).message).not.toContain('SENHA-SECRETA');
      expect((e as Error).message).not.toContain('usuario');
    }
  });

  it('LN_TEST_ALLOW_REMOTE=1 libera de propósito', () => {
    process.env.LN_TEST_ALLOW_REMOTE = '1';
    expect(() => assertLocalTestHost('postgres://u:p@db.remoto.example/db', 'LN_TEST_PG_URL')).not.toThrow();
  });
});

describe('aviso de variáveis pela metade', () => {
  const limpar = () => {
    delete process.env.LN_TEST_PG_URL;
    delete process.env.LN_TEST_CERTS_DIR;
    delete process.env.LN_TEST_REDIS_TLS_URL;
  };
  afterEach(() => {
    limpar();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const comEnv = async (env: Record<string, string>) => {
    vi.restoreAllMocks(); // cada chamada começa com um espião novo (senão a contagem acumula)
    vi.resetModules();
    limpar();
    Object.assign(process.env, env);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mod = await import('./testing');
    const real = mod.isRealTestDb();
    return { warn, real };
  };

  it('só LN_TEST_PG_URL: avisa que a execução é em PGlite (uma vez só) e não liga o modo real', async () => {
    const { warn, real } = await comEnv({ LN_TEST_PG_URL: 'postgres://u:p@127.0.0.1:55432/postgres' });
    expect(real).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/PGlite, NÃO o PostgreSQL real/);
    expect(String(warn.mock.calls[0]![0])).not.toContain('u:p@'); // nunca a URL
    const mod = await import('./testing');
    mod.isRealTestDb();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('só LN_TEST_CERTS_DIR avisa, exceto quando é para o teste de TLS do Redis (LN_TEST_REDIS_TLS_URL); sem nenhuma, silêncio', async () => {
    expect((await comEnv({ LN_TEST_CERTS_DIR: '/x' })).warn).toHaveBeenCalledTimes(1);
    expect((await comEnv({ LN_TEST_CERTS_DIR: '/x', LN_TEST_REDIS_TLS_URL: 'rediss://127.0.0.1:1' })).warn).not.toHaveBeenCalled();
    expect((await comEnv({})).warn).not.toHaveBeenCalled();
  });
});
