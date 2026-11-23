import { afterEach, describe, expect, it } from 'vitest';
import { initRuntimeFlags, resetRuntimeFlagsForTest, runtimeFlagNames, runtimeFlags } from './runtime-flags';

afterEach(() => resetRuntimeFlagsForTest());

describe('runtime-flags (memo da subida)', () => {
  it('deps e health leem o mesmo resultado memoizado', () => {
    initRuntimeFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas' });
    expect(runtimeFlags().intelligencePessoas).toBe(true);
    expect(runtimeFlagNames()).toEqual(['intelligencePessoas']);
  });
  it('produção limpa: flags []', () => {
    initRuntimeFlags({ APP_ENV: 'production' });
    expect(runtimeFlagNames()).toEqual([]);
    expect(runtimeFlags().intelligencePessoas).toBe(false);
  });
  it('configuração inválida lança na inicialização', () => {
    expect(() => initRuntimeFlags({ APP_ENV: 'production', LN_FLAGS_ON: 'intelligencePessoas' })).toThrow(/sem decisão para production/);
  });
  it('cópia: mutar o retorno não altera o memo', () => {
    initRuntimeFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas' });
    runtimeFlags().intelligencePessoas = false;
    expect(runtimeFlags().intelligencePessoas).toBe(true);
  });
});
