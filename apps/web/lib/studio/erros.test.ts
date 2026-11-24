import { describe, expect, it } from 'vitest';
import { traduzirDetalhe, traduzirMensagem } from './erros';

describe('traduzirMensagem', () => {
  it('traduz as mensagens comuns do validador', () => {
    expect(traduzirMensagem('Invalid URL')).toBe('URL inválida (use https://…).');
    expect(traduzirMensagem('Too small: expected string to have >=3 characters')).toBe('precisa ter pelo menos 3 caracteres.');
    expect(traduzirMensagem('Too small: expected string to have >=1 characters')).toBe('obrigatório.');
    expect(traduzirMensagem('Too big: expected string to have <=70 characters')).toBe('pode ter no máximo 70 caracteres.');
    expect(traduzirMensagem('Invalid input: expected string, received undefined')).toBe('obrigatório.');
    expect(traduzirMensagem('Invalid option: expected one of "a"|"b"')).toBe('opção inválida.');
    expect(traduzirMensagem('Invalid string: must match pattern /^x$/')).toBe('formato inválido.');
  });
  it('o que não reconhece passa como veio (mensagem de negócio já em português fica intacta)', () => {
    expect(traduzirMensagem('Slug já existe.')).toBe('Slug já existe.');
    expect(traduzirMensagem('mensagem nova do validador')).toBe('mensagem nova do validador');
  });
});

describe('traduzirDetalhe', () => {
  it('usa o nome do campo na tela, não o caminho interno', () => {
    expect(traduzirDetalhe({ path: 'slug', message: 'Too small: expected string to have >=3 characters' })).toBe('Slug: precisa ter pelo menos 3 caracteres.');
    expect(traduzirDetalhe({ path: 'dadosEstruturados.organizacao.url', message: 'Invalid URL' })).toBe('Organização: URL do site: URL inválida (use https://…).');
    expect(traduzirDetalhe({ path: 'fonteUrl', message: 'Invalid URL' })).toBe('URL da fonte oficial: URL inválida (use https://…).');
  });
  it('campos aninhados da mídia usam o nome da tela', () => {
    expect(traduzirDetalhe({ path: 'direitos.url', message: 'Invalid URL' })).toBe('URL do ativo: URL inválida (use https://…).');
  });
  it('itens de lista viram "Bloco 3: …" (a contagem na tela começa em 1)', () => {
    expect(traduzirDetalhe({ path: 'blocos[2].limite', message: 'Too big: expected number to have <=12' })).toBe('Bloco 3: Limite de itens: no máximo 12.');
    expect(traduzirDetalhe({ path: 'regras[0].termo', message: 'Invalid input' })).toBe('Regra 1: Termo: valor inválido.');
  });
  it('caminho desconhecido aparece como veio; sem caminho só a mensagem', () => {
    expect(traduzirDetalhe({ path: 'campoNovo', message: 'Invalid URL' })).toBe('campoNovo: URL inválida (use https://…).');
    expect(traduzirDetalhe({ message: 'Invalid URL' })).toBe('URL inválida (use https://…).');
  });
  it('campos do comercial e do Creative (chaves da API em inglês) usam o nome da tela', () => {
    expect(traduzirDetalhe({ path: 'endDate', message: 'endDate anterior a startDate' })).toBe('Fim: endDate anterior a startDate');
    expect(traduzirDetalhe({ path: 'basis', message: 'Invalid option: expected one of "consentimento"|"legitimo_interesse"' })).toBe('Base legal: opção inválida.');
    expect(traduzirDetalhe({ path: 'email', message: 'Too small: expected string to have >=1 characters' })).toBe('E-mail: obrigatório.');
    expect(traduzirDetalhe({ path: 'positionIds', message: 'Too small: expected array to have >=1 items' })).toBe('Posições da campanha: precisa de pelo menos 1.');
    expect(traduzirDetalhe({ path: 'articleId', message: 'Required' })).toBe('Matéria: obrigatório.');
  });
});
