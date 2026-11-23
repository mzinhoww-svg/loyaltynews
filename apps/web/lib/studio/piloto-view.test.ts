import { describe, expect, it } from 'vitest';
import { achadosDoFormulario, erroDoVeredito, mapaDoFormulario } from './piloto-view';

const OK = { fatosNasEvidencias: true, tom: true, nadaInventado: true };

describe('piloto-view (contrato ft/editorial ccfb23c)', () => {
  it('achados: vazias ignoradas; gravidade padrão do tipo; trecho 3 a 500; tipo válido (causa, não causa_efeito)', () => {
    expect(achadosDoFormulario([{ trecho: ' 12% ', tipo: 'numero', gravidade: '', evidenciaId: '' }, { trecho: '', tipo: '', gravidade: '', evidenciaId: '' }])).toEqual({
      ok: true, achados: [{ trecho: '12%', tipo: 'numero', gravidade: 'alta' }],
    });
    expect(achadosDoFormulario([{ trecho: 'porque subiu', tipo: 'causa', gravidade: '', evidenciaId: 'ev_1' }])).toEqual({ ok: true, achados: [{ trecho: 'porque subiu', tipo: 'causa', gravidade: 'media', evidenciaId: 'ev_1' }] });
    expect(achadosDoFormulario([{ trecho: 'ab', tipo: 'numero', gravidade: '', evidenciaId: '' }])).toMatchObject({ ok: false });
    expect(achadosDoFormulario([{ trecho: 'x'.repeat(501), tipo: 'numero', gravidade: '', evidenciaId: '' }])).toMatchObject({ ok: false });
    expect(achadosDoFormulario([{ trecho: 'abc', tipo: 'causa_efeito', gravidade: '', evidenciaId: '' }])).toMatchObject({ ok: false });
  });
  it('veredito: aprovado não aceita achado alta nem checklist incompleto (mesma regra do servidor)', () => {
    expect(erroDoVeredito('', [], OK)).toMatch(/veredito/);
    expect(erroDoVeredito('aprovado', [{ trecho: 'R$ 10', tipo: 'valor', gravidade: 'alta' }], OK)).toMatch(/alta/);
    expect(erroDoVeredito('aprovado', [], { ...OK, tom: false })).toMatch(/três itens/);
    expect(erroDoVeredito('aprovado', [{ trecho: 'Fulano', tipo: 'nome', gravidade: 'media' }], OK)).toBeNull();
    expect(erroDoVeredito('bloqueado', [{ trecho: 'R$ 10', tipo: 'valor', gravidade: 'alta' }], { fatosNasEvidencias: false, tom: false, nadaInventado: false })).toBeNull();
  });
  it('mapa: só matérias preenchidas; vazio recusado', () => {
    expect(mapaDoFormulario({ a1: ' art-1 ', a2: '', a3: 'art-3' })).toEqual({ ok: true, mapa: { a1: 'art-1', a3: 'art-3' } });
    expect(mapaDoFormulario({})).toMatchObject({ ok: false });
  });
});
