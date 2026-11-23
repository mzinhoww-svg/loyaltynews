import { describe, expect, it } from 'vitest';
import { erroDaResolucao, violacoesDa } from './piloto-violacoes';

describe('violações do piloto (contrato ft/backend 0d886d9)', () => {
  it('as quatro paradas imediatas, só quando true', () => {
    expect(violacoesDa({ secret_in_log: true, tool_outside_contract: true, published_attempt: false })).toEqual(['secret_in_log', 'tool_outside_contract']);
    expect(violacoesDa({ tarifada_api_call: 'true' })).toEqual([]);
  });
  it('resolução: linha sem violação, motivo 10–500, ação obrigatória, segredo exige rotação', () => {
    expect(erroDaResolucao({}, 'motivo suficiente', 'agente_corrigido')).toMatch(/não tem parada/);
    expect(erroDaResolucao({ tool_outside_contract: true }, 'curto', 'agente_corrigido')).toMatch(/10 a 500/);
    expect(erroDaResolucao({ tool_outside_contract: true }, 'x'.repeat(501), 'agente_corrigido')).toMatch(/10 a 500/);
    expect(erroDaResolucao({ tool_outside_contract: true }, 'motivo suficiente', ' ')).toMatch(/ação/);
    expect(erroDaResolucao({ secret_in_log: true }, 'motivo suficiente', 'agente_corrigido')).toMatch(/rotacionado/);
    expect(erroDaResolucao({ secret_in_log: true }, 'motivo suficiente', 'segredo_rotacionado')).toBeNull();
    expect(erroDaResolucao({ tool_outside_contract: true }, 'motivo suficiente', 'agente_corrigido')).toBeNull();
  });
});
