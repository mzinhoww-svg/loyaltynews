import { describe, expect, it } from 'vitest';
import { caminhoDoPedido, destinoSeguro, erroDeCodigo, erroDeEntrada, limparCodigo, textoEspera } from './login';

describe('destinoSeguro (retorno depois do 2º fator)', () => {
  it('aceita caminhos do Studio', () => {
    expect(destinoSeguro('/studio')).toBe('/studio');
    expect(destinoSeguro('/studio/cms')).toBe('/studio/cms');
    expect(destinoSeguro('/studio/cms/abc-123?status=aprovado&q=alfa')).toBe('/studio/cms/abc-123?status=aprovado&q=alfa');
  });
  it('recusa outro site, protocolo, // , barra invertida e ..', () => {
    for (const ruim of ['https://evil.example/studio', '//evil.example', '/\\evil.example', '/studio//evil.example', '/studio/../admin', '/studio\\x', 'javascript:alert(1)', '/portal', '/studioX', '/studio/<script>', '/studio?x=<a>', '']) {
      expect(destinoSeguro(ruim), ruim).toBe('/studio');
    }
    expect(destinoSeguro(undefined)).toBe('/studio');
    expect(destinoSeguro(['/studio/cms'])).toBe('/studio');
    expect(destinoSeguro('/studio/' + 'a'.repeat(400))).toBe('/studio');
  });
  it('nunca volta para a própria tela de entrada (laço)', () => {
    expect(destinoSeguro('/studio/entrar')).toBe('/studio');
    expect(destinoSeguro('/studio/entrar?motivo=NO_SESSION')).toBe('/studio');
  });
});

describe('textoEspera (Retry-After do 429)', () => {
  it('segundos, minutos arredondados para cima e padrão', () => {
    expect(textoEspera('30')).toBe('30 segundos');
    expect(textoEspera('1')).toBe('1 segundo');
    expect(textoEspera('60')).toBe('1 minuto');
    expect(textoEspera('901')).toBe('16 minutos');
    expect(textoEspera(null)).toBe('alguns minutos');
    expect(textoEspera('abc')).toBe('alguns minutos');
    expect(textoEspera('0')).toBe('alguns minutos');
  });
});

describe('erroDeEntrada (genérico: não revela se a conta existe)', () => {
  it('a mesma mensagem para conta inexistente, senha errada e conta bloqueada pelo Backend', () => {
    const msg = erroDeEntrada({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' });
    expect(msg).toBe('E-mail ou senha incorretos.');
    expect(erroDeEntrada({ status: 401, code: 'USER_NOT_FOUND' })).toBe(msg);
    expect(erroDeEntrada({ status: 403, code: 'BANNED_USER' })).toBe(msg);
    expect(erroDeEntrada({ status: 400 })).toBe(msg);
    expect(msg).not.toMatch(/existe|cadastrad|não encontrad|bloquead|banid/i);
  });
  it('429 mostra o tempo de espera; 503 e 5xx têm texto próprio', () => {
    expect(erroDeEntrada({ status: 429, retryAfter: '900' })).toContain('15 minutos');
    expect(erroDeEntrada({ status: 503 })).toContain('não está configurado');
    expect(erroDeEntrada({ status: 500 })).toContain('Tente de novo em instantes');
  });
});

describe('erroDeCodigo', () => {
  it('código errado fica no passo; cookie expirado reinicia', () => {
    expect(erroDeCodigo({ status: 401, code: 'INVALID_CODE' }, false)).toMatchObject({ reiniciar: false, texto: expect.stringContaining('Código inválido') });
    expect(erroDeCodigo({ status: 401 }, true).texto).toContain('recuperação');
    expect(erroDeCodigo({ status: 401, code: 'INVALID_TWO_FACTOR_COOKIE' }, false)).toMatchObject({ reiniciar: true });
  });
  it('429 com espera', () => {
    expect(erroDeCodigo({ status: 429, retryAfter: '120' }, false).texto).toContain('2 minutos');
  });
});

describe('limparCodigo / caminhoDoPedido', () => {
  it('só dígitos, até 6', () => {
    expect(limparCodigo('123 456')).toBe('123456');
    expect(limparCodigo('12a3-4567890')).toBe('123456');
  });
  it('tira o _rsc do Next do caminho guardado', () => {
    expect(caminhoDoPedido('/studio/cms', '?_rsc=abc&status=aprovado')).toBe('/studio/cms?status=aprovado');
    expect(caminhoDoPedido('/studio/cms', '')).toBe('/studio/cms');
    expect(caminhoDoPedido('/studio', '?_rsc=1')).toBe('/studio');
  });
});
