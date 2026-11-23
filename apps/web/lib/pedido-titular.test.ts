import { describe, expect, it } from 'vitest';
import { estadoDaResposta, linkPedido, urlDoAlvo, validarPedido, type PedidoValores } from '../app/(portal)/_titular/pedido';

const ok: PedidoValores = {
  nome: 'Maria Titular', contato: 'maria@example.org', url: 'https://portal.example.test/intelligence/pessoas/abc', tipo: 'correcao',
  texto: 'O cargo exibido está desatualizado desde outubro.',
};

describe('validarPedido (mesmas regras do Backend)', () => {
  it('pedido válido não tem erro', () => expect(validarPedido(ok)).toEqual({}));
  it.each([
    ['nome', { nome: 'M' }],
    ['nome', { nome: 'x'.repeat(201) }],
    ['contato', { contato: 'nao-e-email' }],
    ['url', { url: 'javascript:alert(1)' }],
    ['url', { url: 'portal.example.test/x' }],
    ['url', { url: `https://x.test/${'a'.repeat(2050)}` }],
    ['tipo', { tipo: 'outro' }],
    ['texto', { texto: 'curto' }],
    ['texto', { texto: 'x'.repeat(5001) }],
  ] as const)('%s inválido: %j', (campo, over) => {
    expect(Object.keys(validarPedido({ ...ok, ...over }))).toEqual([campo]);
  });
  it('espaços nas pontas não contam', () => expect(validarPedido({ ...ok, nome: '  M  ' }).nome).toBeDefined());
});

describe('urlDoAlvo', () => {
  const origin = 'https://portal.example.test';
  it('caminho interno vira URL completa do próprio site', () => {
    expect(urlDoAlvo('/intelligence/pessoas/abc', origin)).toBe('https://portal.example.test/intelligence/pessoas/abc');
  });
  it.each([null, '', 'https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', `/${'a'.repeat(600)}`])('recusa %j', (alvo) => {
    expect(urlDoAlvo(alvo, origin)).toBe('');
  });
  it('alvo com ?cargo= (pedido por cargo) é aceito e preservado', () => {
    expect(urlDoAlvo('/intelligence/pessoas/abc?cargo=def', origin)).toBe('https://portal.example.test/intelligence/pessoas/abc?cargo=def');
    expect(linkPedido('/intelligence/pessoas/abc?cargo=def')).toBe('/correcoes?alvo=%2Fintelligence%2Fpessoas%2Fabc%3Fcargo%3Ddef#pedido');
  });
  it('link do botão leva ao formulário com o alvo', () => {
    expect(linkPedido('/intelligence/pessoas/abc')).toBe('/correcoes?alvo=%2Fintelligence%2Fpessoas%2Fabc#pedido');
  });
});

describe('estadoDaResposta', () => {
  it.each([
    [202, 'recebido'], [400, 'invalido'], [413, 'invalido'], [429, 'muitos'], [500, 'falha'], [503, 'falha'], [404, 'falha'],
  ] as const)('%i → %s', (s, e) => expect(estadoDaResposta(s)).toBe(e));
});
