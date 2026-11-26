import { describe, expect, it } from 'vitest';
import { PROTOCOLO_RE, protocoloDoPedido, protocoloValido } from './protocolo-titular';
import { reciboDaResposta } from '../app/(portal)/_titular/pedido';

const ID = '412256f9-d852-4d79-9f08-58ba307286a8';
const PRAZO = '2026-12-16T12:00:00.000Z';

describe('protocolo do titular: gerar e validar pela mesma regra', () => {
  it('gera no formato e o parser do portal aceita o mesmo texto', () => {
    const p = protocoloDoPedido(ID);
    expect(p).toBe('LN-412256F9D852');
    expect(PROTOCOLO_RE.test(p)).toBe(true);
    expect(protocoloValido(p)).toBe(true);
    expect(reciboDaResposta({ protocolo: p, prazoDias: 15, prazoEm: PRAZO })).toMatchObject({ protocolo: p });
  });

  it('controle negativo: formato divergente só no gerador não passa na validação nem no parser', () => {
    // Simula alguém mudando o formato SÓ no gerador (13 hex, minúsculas, sem prefixo).
    const divergentes = [
      `LN-${ID.replace(/-/g, '').slice(0, 13).toUpperCase()}`,
      `LN-${ID.replace(/-/g, '').slice(0, 12).toLowerCase()}`,
      ID.replace(/-/g, '').slice(0, 12).toUpperCase(),
    ];
    for (const p of divergentes) {
      expect(protocoloValido(p), p).toBe(false);
      expect(reciboDaResposta({ protocolo: p, prazoDias: 15, prazoEm: PRAZO }), p).toBeNull();
    }
  });
});
