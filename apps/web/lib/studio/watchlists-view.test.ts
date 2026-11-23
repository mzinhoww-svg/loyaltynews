import { describe, expect, it } from 'vitest';
import { ROTULO_ALERTA, ROTULO_ESTADO_MOVE, erroDoNome, estadoDoFiltro, tipoDeEntidade } from './watchlists-view';

describe('watchlists-view', () => {
  it('filtro de estado aceita só os três estados; o resto é pendente', () => {
    expect(estadoDoFiltro('approved')).toBe('approved');
    expect(estadoDoFiltro('rejected')).toBe('rejected');
    expect(estadoDoFiltro(undefined)).toBe('pending_review');
    expect(estadoDoFiltro("x' OR 1=1")).toBe('pending_review');
  });
  it('tipo de entidade: só organization e person', () => {
    expect(tipoDeEntidade('organization')).toBe('organization');
    expect(tipoDeEntidade('person')).toBe('person');
    expect(tipoDeEntidade('article')).toBeNull();
    expect(tipoDeEntidade('')).toBeNull();
  });
  it('nome da lista: 1 a 120 caracteres, como o Backend valida', () => {
    expect(erroDoNome('  ')).toMatch(/nome/);
    expect(erroDoNome('a'.repeat(121))).toMatch(/120/);
    expect(erroDoNome('Bancos')).toBeNull();
    expect(erroDoNome('a'.repeat(120))).toBeNull();
  });
  it('rótulos distinguem o estado do alerta do estado do Move', () => {
    expect(ROTULO_ALERTA.pending_review).toBe('Pendente de revisão');
    expect(ROTULO_ESTADO_MOVE.detected).toMatch(/não confirmado/);
    expect(ROTULO_ESTADO_MOVE.confirmed).toBe('Move confirmado');
  });
});
