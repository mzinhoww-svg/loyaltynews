import { describe, expect, it } from 'vitest';
import { vendaLiberadaNoAmbiente } from './comercial';

describe('DP-43 por ambiente no Studio (venda, aprovação e ativação)', () => {
  it('só o staging libera; produção (null no FLAG_RELEASES) e ambiente desconhecido desligam', () => {
    expect(vendaLiberadaNoAmbiente('staging')).toBe(true);
    expect(vendaLiberadaNoAmbiente(' Staging ')).toBe(true);
    expect(vendaLiberadaNoAmbiente('production')).toBe(false);
    expect(vendaLiberadaNoAmbiente('producao')).toBe(false);
    expect(vendaLiberadaNoAmbiente(undefined)).toBe(false);
    expect(vendaLiberadaNoAmbiente('local')).toBe(false);
  });
});
