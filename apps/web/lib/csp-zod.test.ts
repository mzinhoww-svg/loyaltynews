import { afterAll, describe, expect, it, vi } from 'vitest';

// A violação medida no navegador (27/11) vinha do teste `new Function` do Zod. Aqui: a instrumentação do navegador liga `jitless`
// ANTES de o Zod carregar e o Zod real deixa de chamar `Function`.
const g = globalThis as typeof globalThis & { __zod_globalConfig?: Record<string, unknown> };
const original = g.Function;

describe('Zod sob a CSP', () => {
  afterAll(() => {
    g.Function = original;
  });

  it('com a instrumentação, validar um objeto não chama Function()', async () => {
    vi.resetModules();
    delete g.__zod_globalConfig;
    await import('../instrumentation-client');
    expect(g.__zod_globalConfig).toMatchObject({ jitless: true });
    const { z } = await import('zod');
    const chamadas: unknown[] = [];
    g.Function = new Proxy(original, { apply: (a, t, args) => (chamadas.push(args), Reflect.apply(a, t, args)), construct: (a, args) => (chamadas.push(args), Reflect.construct(a, args)) });
    expect(z.object({ nome: z.string() }).parse({ nome: 'x' })).toEqual({ nome: 'x' });
    g.Function = original;
    expect(z.config().jitless).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it('não apaga configuração que o Zod já tenha', async () => {
    vi.resetModules();
    const existente = { outra: 1 };
    g.__zod_globalConfig = existente;
    await import('../instrumentation-client');
    expect(g.__zod_globalConfig).toBe(existente);
    expect(existente).toEqual({ outra: 1, jitless: true });
  });
});
