import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs do script de verificação, sem tipos
import { desfazerEscapes, marcadoresEm } from '../scripts/scan-marcadores.mjs';

const M = ['[MOCK] Matéria de teste', 'Empresa de Teste (MOCK)'];
// String.raw: os textos abaixo têm a barra invertida de verdade, como no JS compilado (o .next guarda "Mat\xe9ria", não "Matéria").
const raw = String.raw;

describe('varredura de marcadores (verify-no-mock)', () => {
  it('acha o marcador literal', () => {
    expect(marcadoresEm('x "[MOCK] Matéria de teste 1" y', M)).toEqual(['[MOCK] Matéria de teste']);
  });
  it('acha o marcador com o acento escapado como \\xHH (JS compilado)', () => {
    const js = raw`t=\`[MOCK] Mat\xe9ria de teste \${a+1}\``;
    expect(js).toContain('Mat\\xe9ria');
    expect(marcadoresEm(js, M)).toEqual(['[MOCK] Matéria de teste']);
  });
  it('acha com \\uHHHH, \\u{...} e entidades numéricas', () => {
    expect(marcadoresEm(raw`"[MOCK] Matéria de teste"`, M)).toHaveLength(1);
    expect(marcadoresEm(raw`"[MOCK] Mat\u{e9}ria de teste"`, M)).toHaveLength(1);
    expect(marcadoresEm('<p>[MOCK] Mat&#233;ria de teste</p>', M)).toHaveLength(1);
    expect(marcadoresEm('<p>[MOCK] Mat&#xe9;ria de teste</p>', M)).toHaveLength(1);
  });
  it('controle negativo: texto limpo ou com outra frase escapada não casa', () => {
    expect(marcadoresEm(raw`Mat\xe9ria publicada de verdade`, M)).toEqual([]);
    expect(marcadoresEm(raw`[MOCK] Mat\xe9ria de produ\xe7\xe3o`, M)).toEqual([]);
    expect(marcadoresEm('', M)).toEqual([]);
  });
  it('escape inválido (fora do intervalo) fica como está e não quebra', () => {
    const ruim = raw`\u{110000} \xZZ &#99999999;`;
    expect(desfazerEscapes(ruim)).toBe(ruim);
  });
});
