import { describe, expect, it } from 'vitest';
import { estadoDaLista } from './estados';

// A regra que evita o "zero sem explicação": falha de leitura nunca vira lista vazia.
describe('estadoDaLista', () => {
  it('erro de leitura vira erro mesmo com total zero (zero não é fato quando a leitura falhou)', () => {
    expect(estadoDaLista(true, 0)).toBe('erro');
    expect(estadoDaLista(true, 3)).toBe('erro');
  });

  it('leitura boa e nenhum item vira vazio honesto', () => {
    expect(estadoDaLista(false, 0)).toBe('vazio');
  });

  it('leitura boa com itens é a lista normal', () => {
    expect(estadoDaLista(false, 2)).toBe('ok');
  });
});
