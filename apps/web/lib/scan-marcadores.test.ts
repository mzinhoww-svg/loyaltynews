import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs do script de verificação, sem tipos
import { desfazerEscapes, marcadoresEm } from '../scripts/scan-marcadores.mjs';

const M = ['[MOCK] Matéria de teste', 'Empresa de Teste (MOCK)'];
// As barras invertidas são montadas por código (BS) para o teste não depender de como o editor grava escapes: o .next guarda "Mat" + BS + "xe9ria".
const BS = String.fromCharCode(92);
const mat = (esc: string) => `[MOCK] Mat${esc}ria de teste`;

describe('varredura de marcadores (verify-no-mock)', () => {
  it('acha o marcador literal', () => {
    expect(marcadoresEm('x "[MOCK] Matéria de teste 1" y', M)).toEqual(['[MOCK] Matéria de teste']);
  });
  it('acha o marcador com o acento escapado como xHH (JS compilado)', () => {
    const js = 't=`' + mat(`${BS}xe9`) + ' ${a+1}`';
    expect(js).toContain(`${BS}xe9`);
    expect(js).not.toContain('é');
    expect(marcadoresEm(js, M)).toEqual(['[MOCK] Matéria de teste']);
  });
  it('acha com uHHHH, u{...} e entidades numéricas (nenhum "é" literal no texto)', () => {
    for (const t of [mat(`${BS}u00e9`), mat(`${BS}u{e9}`), mat('&#233;'), mat('&#xe9;'), mat('&eacute;')]) {
      expect(t).not.toContain('é');
      expect(marcadoresEm(t, M)).toEqual(['[MOCK] Matéria de teste']);
    }
  });
  it('acha escape duplo (JSON dentro de string JS) e forma decomposta NFD', () => {
    const duplo = mat(`${BS}${BS}u00e9`);
    expect(duplo).toContain(`${BS}${BS}u00e9`);
    expect(marcadoresEm(duplo, M)).toHaveLength(1);
    const agudo = String.fromCharCode(0x301);
    const nfd = `[MOCK] Mate${agudo}ria de teste`;
    expect(nfd).not.toContain('é');
    expect(marcadoresEm(nfd, M)).toEqual(['[MOCK] Matéria de teste']);
  });
  it('controle negativo: texto limpo ou com outra frase escapada não casa', () => {
    expect(marcadoresEm(`Mat${BS}xe9ria publicada de verdade`, M)).toEqual([]);
    expect(marcadoresEm(`[MOCK] Mat${BS}xe9ria de produ${BS}xe7${BS}xe3o`, M)).toEqual([]);
    expect(marcadoresEm('[MOCK] Mat&eacute;ria de produ&ccedil;&atilde;o', M)).toEqual([]);
    expect(marcadoresEm('', M)).toEqual([]);
  });
  it('escape inválido (fora do intervalo) fica como está e não quebra', () => {
    const ruim = `${BS}u{110000} ${BS}xZZ &#99999999; &inexistente;`;
    expect(desfazerEscapes(ruim)).toBe(ruim);
  });
});
