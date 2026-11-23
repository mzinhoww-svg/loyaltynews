import { describe, expect, it } from 'vitest';
import { camposDaCorrecao, estadoDoFiltro, linkDoAlvo, rotuloAcaoAuditoria, situacaoDoPrazo, ROTULO_ESTADO } from './titular-view';

const agora = new Date('2026-11-23T12:00:00Z');
const dias = (n: number) => new Date(agora.getTime() + n * 86_400_000).toISOString();

describe('titular-view (DP-38)', () => {
  it('prazo interno: vencido, vence em até 3 dias, no prazo, encerrado quando decidido', () => {
    expect(situacaoDoPrazo({ prazo_em: dias(-1), estado: 'recebido' }, agora)).toBe('vencido');
    expect(situacaoDoPrazo({ prazo_em: dias(2), estado: 'em_analise' }, agora)).toBe('vence_logo');
    expect(situacaoDoPrazo({ prazo_em: dias(3), estado: 'recebido' }, agora)).toBe('vence_logo');
    expect(situacaoDoPrazo({ prazo_em: dias(10), estado: 'recebido' }, agora)).toBe('no_prazo');
    expect(situacaoDoPrazo({ prazo_em: dias(-5), estado: 'negado' }, agora)).toBe('encerrado');
  });
  it('filtro de estado: só os cinco; o resto vira todos', () => {
    expect(estadoDoFiltro('em_analise')).toBe('em_analise');
    expect(estadoDoFiltro('apagado')).toBeUndefined();
    expect(estadoDoFiltro(undefined)).toBeUndefined();
  });
  it('campos da correção: ignora pares vazios, exige nome do campo, 1 a 20', () => {
    expect(camposDaCorrecao([['nome', 'Ana Souza'], ['', ''], [' cargo ', ' Diretora ']])).toEqual({ ok: true, campos: { nome: 'Ana Souza', cargo: 'Diretora' } });
    expect(camposDaCorrecao([['', ''], ['', '']])).toMatchObject({ ok: false });
    expect(camposDaCorrecao([['', 'valor sem campo']])).toMatchObject({ ok: false, erro: expect.stringMatching(/nome do campo/) });
    expect(camposDaCorrecao([['x'.repeat(61), 'v']])).toMatchObject({ ok: false });
    expect(camposDaCorrecao(Array.from({ length: 21 }, (_, i) => [`c${i}`, 'v'] as [string, string]))).toMatchObject({ ok: false, erro: expect.stringMatching(/20/) });
  });
  it('link do alvo só para pessoa (página do executivo); cargo, move e nada: null', () => {
    expect(linkDoAlvo({ tipo: 'pessoa', id: 'p 1', nome: null, empresa: null })).toBe('/studio/entidades/pessoa/p%201');
    expect(linkDoAlvo({ tipo: 'cargo', id: 'c', nome: null, empresa: null })).toBeNull();
    expect(linkDoAlvo(null)).toBeNull();
  });
  it('rótulos: decisão é registrada, nunca "removido do portal"', () => {
    for (const r of Object.values(ROTULO_ESTADO)) expect(r).not.toMatch(/portal/i);
    expect(ROTULO_ESTADO.removido).toMatch(/registrada/);
    expect(rotuloAcaoAuditoria('titular.pedido_consultado')).toBe('pedido consultado');
  });
});
