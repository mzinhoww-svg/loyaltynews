import { afterEach, describe, expect, it } from 'vitest';
import { initRuntimeFlags, resetRuntimeFlagsForTest, runtimeFlagNames, runtimeFlags } from './runtime-flags';

afterEach(() => resetRuntimeFlagsForTest());

describe('runtime-flags (memo da subida)', () => {
  it('deps e health leem o mesmo resultado memoizado', () => {
    initRuntimeFlags({ APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas' });
    expect(runtimeFlags().intelligencePessoas).toBe(true);
    expect(runtimeFlagNames()).toEqual(['intelligencePessoas']);
  });
  it('produção limpa: só as flags por commit (DP-57: portalFormularios; DP-76: publicacaoPortal); adServerVendas, intelligencePessoas e publicacaoAutonoma desligadas', () => {
    initRuntimeFlags({ APP_ENV: 'production' });
    expect(runtimeFlagNames()).toEqual(['portalFormularios', 'publicacaoPortal']);
    expect(runtimeFlags().portalFormularios).toBe(true);
    expect(runtimeFlags().publicacaoPortal).toBe(true);
    expect(runtimeFlags().publicacaoAutonoma).toBe(false);
    expect(runtimeFlags().intelligencePessoas).toBe(false);
    expect(runtimeFlags().adServerVendas).toBe(false);
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
