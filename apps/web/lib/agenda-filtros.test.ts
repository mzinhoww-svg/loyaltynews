import { describe, expect, it } from 'vitest';
import { mapEvent } from '../app/(portal)/_lib/api-source';
import { filtroDaAgenda } from '../app/(portal)/_lib/events';

// N2: o que a API publica (sem modalidade) não pode ganhar filtros que escondem tudo.
const daApi = mapEvent({ id: 'ev-1', titulo: 'Congresso', inicio: '2026-12-04', fim: '2026-12-05', local: 'São Paulo' });

describe('filtros da agenda', () => {
  it('evento vindo da API não tem modalidade: sem filtros, e qualquer ?filtro= vale "todos"', () => {
    expect(daApi.online).toBeUndefined();
    for (const pedido of [undefined, 'online', 'presencial', 'x']) {
      expect(filtroDaAgenda([daApi], pedido), String(pedido)).toEqual({ mostrarFiltros: false, filtro: 'todos' });
    }
    expect(filtroDaAgenda([], 'online')).toEqual({ mostrarFiltros: false, filtro: 'todos' });
  });

  it('controle negativo: com modalidade informada os filtros aparecem e valem; pedido desconhecido cai em "todos"', () => {
    const eventos = [{ online: true }, { online: false }, {}];
    expect(filtroDaAgenda(eventos, 'online')).toEqual({ mostrarFiltros: true, filtro: 'online' });
    expect(filtroDaAgenda(eventos, 'presencial')).toEqual({ mostrarFiltros: true, filtro: 'presencial' });
    expect(filtroDaAgenda(eventos, 'x')).toEqual({ mostrarFiltros: true, filtro: 'todos' });
  });
});
