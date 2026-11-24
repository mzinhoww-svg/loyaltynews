import { describe, expect, it } from 'vitest';
import { rotuloAprovador } from './aprovador';

const ID = '3f2a9c1e-8d7b-4a55-9c0e-1b2c3d4e5f60';

describe('rotuloAprovador', () => {
  it('a própria sessão é "você", mesmo com nome', () => {
    expect(rotuloAprovador(ID, 'Ana Souza', ID)).toBe('você');
    expect(rotuloAprovador(ID, null, ID)).toBe('você');
  });
  it('outra pessoa aparece pelo nome', () => {
    expect(rotuloAprovador(ID, 'Ana Souza', 'outro-id')).toBe('Ana Souza');
    expect(rotuloAprovador(ID, '  Ana Souza  ', 'outro-id')).toBe('Ana Souza');
  });
  it('sem nome (usuário removido, campo ausente ou vazio) cai no identificador curto', () => {
    expect(rotuloAprovador(ID, null, 'outro-id')).toBe('outro usuário (3f2a9c1e…)');
    expect(rotuloAprovador(ID, undefined, 'outro-id')).toBe('outro usuário (3f2a9c1e…)');
    expect(rotuloAprovador(ID, '   ', 'outro-id')).toBe('outro usuário (3f2a9c1e…)');
  });
});
