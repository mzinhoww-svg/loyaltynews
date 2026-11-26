import { describe, expect, it } from 'vitest';
import { filterMoves, moveTexto } from '../app/(portal)/_lib/moves-filter';
import type { MoveEntry } from '../app/(portal)/_lib/types';

const leitura = (company: string) => ({
  title: 'Cargo', company: { id: '00000000-0000-4000-8000-000000000001', name: company },
  validFrom: '2026-01-01', validTo: null, validatedAt: '2026-11-23T00:00:00.000Z',
  source: { name: 'Fonte', url: 'https://fonte.invalid/p', retrievedAt: '2026-11-23T00:00:00.000Z' },
});

const move = (id: string, pessoa: string, antes: string, depois: string): MoveEntry => ({
  id, kind: 'org_change', basis: 'observed_diff', person: { id: `p-${id}`, name: pessoa },
  effectiveDate: null, observedOn: '2026-11-20', before: leitura(antes), after: leitura(depois),
});

const MOVES = [move('1', 'Ana Souza', 'Banco Beta', 'Programa Alfa'), move('2', 'Bruno Lima', 'Clube Delta', 'Banco Beta')];

describe('filtro de texto do Moves', () => {
  it('busca por pessoa e pelas empresas do antes e do depois', () => {
    expect(filterMoves(MOVES, 'ana').map((m) => m.id)).toEqual(['1']);
    expect(filterMoves(MOVES, 'alfa').map((m) => m.id)).toEqual(['1']);
    expect(filterMoves(MOVES, 'delta').map((m) => m.id)).toEqual(['2']);
    expect(filterMoves(MOVES, 'banco').map((m) => m.id)).toEqual(['1', '2']);
  });

  it('ignora acento, caixa e espaço; termo vazio devolve tudo', () => {
    expect(filterMoves(MOVES, '  ÁNA ').map((m) => m.id)).toEqual(['1']);
    expect(filterMoves(MOVES, '')).toHaveLength(2);
    expect(filterMoves(MOVES, '   ')).toHaveLength(2);
  });

  it('filtro sem casamento devolve vazio (a página diz "nenhum para este filtro", não "sem publicações")', () => {
    expect(filterMoves(MOVES, 'ninguem-com-esse-nome')).toEqual([]);
    expect(moveTexto(MOVES[0]!)).toBe('Ana Souza Banco Beta Programa Alfa');
  });
});
