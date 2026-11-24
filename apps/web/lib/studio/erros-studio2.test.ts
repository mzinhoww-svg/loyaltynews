import { describe, expect, it } from 'vitest';
import { mensagemErro } from './backend';
import { traduzirDetalhe } from './erros';

// P1-02 da auditoria de UX nas telas do Studio 2: os caminhos que as rotas de watchlists, pedidos do titular e piloto devolvem
// (contratos do Intelligence, Backend 2, Editorial e Backend 1) viram o nome do campo na tela, em português.
describe('erros nas telas do Studio 2', () => {
  it('watchlists e pedidos do titular', () => {
    expect(traduzirDetalhe({ path: 'entityType', message: 'Invalid option: expected one of "organization"|"person"' })).toBe('Tipo de entidade: opção inválida.');
    expect(traduzirDetalhe({ path: 'responsavel', message: 'Too small: expected string to have >=1 characters' })).toBe('Responsável: obrigatório.');
    expect(traduzirDetalhe({ path: 'motivo', message: 'Too small: expected string to have >=5 characters' })).toBe('Motivo: precisa ter pelo menos 5 caracteres.');
    expect(traduzirDetalhe({ path: 'campos', message: 'informe de 1 a 20 campos' })).toBe('Campos corrigidos: informe de 1 a 20 campos');
  });
  it('leitura do piloto, importação e violações (caminhos aninhados)', () => {
    expect(traduzirDetalhe({ path: 'achados[0].trecho', message: 'Too small: expected string to have >=3 characters' })).toBe('Achado 1: Trecho: precisa ter pelo menos 3 caracteres.');
    expect(traduzirDetalhe({ path: 'achados[2].gravidade', message: 'Invalid option: expected one of "alta"|"media"|"baixa"' })).toBe('Achado 3: Gravidade: opção inválida.');
    expect(traduzirDetalhe({ path: 'leituras[1].achados[0].tipo', message: 'Invalid option' })).toBe('Leitura 2: Achado 1: Tipo do fato: opção inválida.');
    expect(traduzirDetalhe({ path: 'checklist.tom', message: 'Invalid input: expected boolean, received string' })).toBe('Conferência: tom: valor com formato inválido.');
    expect(traduzirDetalhe({ path: 'arquivo.sha256', message: 'Invalid string: must match pattern /^[0-9a-f]{64}$/' })).toBe('Arquivo: hash: formato inválido.');
    expect(traduzirDetalhe({ path: 'leitor2Nome', message: 'Too big: expected string to have <=80 characters' })).toBe('Quem leu: pode ter no máximo 80 caracteres.');
    expect(traduzirDetalhe({ path: 'acaoTomada', message: 'Too small: expected string to have >=1 characters' })).toBe('Ação tomada: obrigatório.');
  });
  it('mensagemErro junta a mensagem de negócio do Backend com os campos traduzidos', () => {
    const r = { status: 400, ok: false as const, body: { error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: [{ path: 'achados[0].trecho', message: 'Too small: expected string to have >=3 characters' }, { path: 'veredito', message: 'Invalid option' }] } } };
    expect(mensagemErro(r)).toBe('Dados inválidos. Achado 1: Trecho: precisa ter pelo menos 3 caracteres.; Veredito: opção inválida.');
    expect(mensagemErro(r)).not.toMatch(/achados\[|Too small|Invalid/);
  });
});
