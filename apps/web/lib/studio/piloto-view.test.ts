import { describe, expect, it } from 'vitest';
import { MATERIAS, achadosDoFormulario, contar, leituraVigente, resultadoPiloto, type Achado, type Leitura, type MateriaId } from './piloto-view';

const leitura = (achados: Achado[], versao = 1, leitor: 1 | 2 = 1): Leitura => ({
  versao, leitor, achados, checklist: { fatosNasEvidencias: true, tom: true, nadaInventado: true }, veredito: achados.length ? 'bloqueado' : 'aprovado', registradoPor: 'u', registradoEm: '2026-11-23T12:00:00Z',
});
const todas = (f: (m: MateriaId) => Leitura[]) => Object.fromEntries(MATERIAS.map((m) => [m, f(m)]));

describe('piloto-view: mesma conta do avaliador (ft/agents 041a74f)', () => {
  it('sem gravidade conta como alta (falha fechada)', () => {
    expect(contar(leitura([{ trecho: 'x', tipo: 'contexto' }]))).toEqual({ unsupported_facts: 1, altas: 1, medias: 0, baixas: 0 });
  });
  it('falta uma matéria = inconclusivo, mesmo sem achados nas outras', () => {
    const r = resultadoPiloto({ ...todas(() => [leitura([])]), a7: [] });
    expect(r).toMatchObject({ estado: 'inconclusivo', faltam: ['a7'] });
  });
  it('0 altas e 1 média = aprovado; baixas só anotadas', () => {
    const r = resultadoPiloto({ ...todas(() => [leitura([{ trecho: 'b', tipo: 'contexto', gravidade: 'baixa' }])]), a2: [leitura([{ trecho: 'm', tipo: 'nome', gravidade: 'media' }])] });
    expect(r).toEqual({ estado: 'aprovado', total: { unsupported_facts: 10, altas: 0, medias: 1, baixas: 9 } });
  });
  it('2 médias ou 1 alta = reprovado', () => {
    const duas = resultadoPiloto({ ...todas(() => [leitura([])]), a1: [leitura([{ trecho: 'm', tipo: 'nome', gravidade: 'media' }])], a2: [leitura([{ trecho: 'm', tipo: 'condicao', gravidade: 'media' }])] });
    expect(duas.estado).toBe('reprovado');
    const alta = resultadoPiloto({ ...todas(() => [leitura([])]), a5: [leitura([{ trecho: 'R$ 10', tipo: 'valor', gravidade: 'alta' }])] });
    expect(alta.estado).toBe('reprovado');
  });
  it('vale a última versão do leitor 1; o leitor 2 não entra na conta', () => {
    const ls = [leitura([{ trecho: 'a', tipo: 'numero', gravidade: 'alta' }], 1), leitura([], 2), leitura([{ trecho: 'z', tipo: 'numero' }], 1, 2)];
    expect(leituraVigente(ls, 1)?.versao).toBe(2);
    expect(resultadoPiloto(todas(() => ls)).estado).toBe('aprovado');
  });
});

describe('achadosDoFormulario', () => {
  it('ignora linhas vazias; gravidade padrão vem do tipo; exige trecho e tipo', () => {
    expect(achadosDoFormulario([{ trecho: ' 12% ', tipo: 'numero', gravidade: '', evidenciaId: '' }, { trecho: '', tipo: '', gravidade: '', evidenciaId: '' }])).toEqual({
      ok: true, achados: [{ trecho: '12%', tipo: 'numero', gravidade: 'alta' }],
    });
    expect(achadosDoFormulario([{ trecho: 'Fulano', tipo: 'nome', gravidade: 'baixa', evidenciaId: 'ev-1' }])).toEqual({ ok: true, achados: [{ trecho: 'Fulano', tipo: 'nome', gravidade: 'baixa', evidenciaId: 'ev-1' }] });
    expect(achadosDoFormulario([{ trecho: '', tipo: 'numero', gravidade: '', evidenciaId: '' }])).toMatchObject({ ok: false });
    expect(achadosDoFormulario([{ trecho: 'x', tipo: 'inventado', gravidade: '', evidenciaId: '' }])).toMatchObject({ ok: false });
  });
});
