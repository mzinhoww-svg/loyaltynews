import { afterEach, describe, expect, it } from 'vitest';
import { resetRuntimeFlagsForTest } from '../../../lib/runtime-flags';
import { GET } from './route';

// Achado do QA 8 (26be6bb): com flag sem decisão para o ambiente, /api/health nunca pode responder 200, nem na janela antes do exit.
const KEYS = ['APP_ENV', 'LN_FLAGS_ON'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetRuntimeFlagsForTest();
});
const get = () => GET(new Request('http://localhost/api/health'));

describe('/api/health com flags inválidas', () => {
  it('produção + flag sem decisão de produção: 503 flags_invalidas, no-store, sem ecoar valor', async () => {
    process.env.APP_ENV = 'production';
    process.env.LN_FLAGS_ON = 'intelligencePessoas';
    resetRuntimeFlagsForTest();
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await r.json();
    expect(body).toEqual({ status: 'indisponivel', motivo: 'flags_invalidas' });
  });
  it('nome desconhecido: 503 sem ecoar o valor bruto', async () => {
    process.env.APP_ENV = 'staging';
    process.env.LN_FLAGS_ON = 'sk-segredo/x';
    resetRuntimeFlagsForTest();
    const r = await get();
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('sk-segredo');
  });
  it('configuração válida segue 200 com flags (staging) e só as flags por commit (produção limpa, DP-57)', async () => {
    process.env.APP_ENV = 'staging';
    process.env.LN_FLAGS_ON = 'intelligencePessoas';
    resetRuntimeFlagsForTest();
    const r = await get();
    expect(r.status).toBe(200);
    expect((await r.json()).flags).toEqual(['intelligencePessoas']);
    process.env.APP_ENV = 'production';
    delete process.env.LN_FLAGS_ON;
    resetRuntimeFlagsForTest();
    expect((await (await get()).json()).flags).toEqual(['portalFormularios', 'publicacaoPortal']); // DP-57 e DP-76, por commit
  });
});
