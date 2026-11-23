import { describe, expect, it } from 'vitest';
import { mensagemDoCodigo, montarEvidencia, montarFonteRapida, novaChave, TRECHO_MAX } from './fonte-rapida';

const fonte = { chave: 'fr-1234abcd', url: 'https://www.banco.com.br/imprensa', nome: 'Sala de imprensa do Banco X', tipo: 'site', licenca: 'desconhecida', editoria: 'bancos' };

describe('chave de idempotência', () => {
  it('prefixo + uuid, no formato aceito (8 a 100: letras, números, : _ . -)', () => {
    const c = novaChave('fr', '7b1c2d3e-aaaa-bbbb-cccc-1234567890ab');
    expect(c).toBe('fr-7b1c2d3e-aaaa-bbbb-cccc-1234567890ab');
    expect(c).toMatch(/^[A-Za-z0-9:_.-]{8,100}$/);
  });
});

describe('montarFonteRapida', () => {
  it('aceita e apara os campos', () => {
    const r = montarFonteRapida({ ...fonte, nome: '  Sala de imprensa  ', url: ' https://www.banco.com.br/imprensa ' });
    expect(r).toEqual({ ok: true, corpo: { ...fonte, nome: 'Sala de imprensa' } });
  });
  it('recusa dizendo o campo: http, credenciais, nome vazio ou longo, tipo, licença, editoria', () => {
    expect(montarFonteRapida({ ...fonte, url: 'http://x.com' })).toMatchObject({ ok: false, erro: expect.stringContaining('URL da fonte') });
    expect(montarFonteRapida({ ...fonte, url: 'https://u:p@x.com' })).toMatchObject({ ok: false });
    expect(montarFonteRapida({ ...fonte, url: 'nao e url' })).toMatchObject({ ok: false });
    expect(montarFonteRapida({ ...fonte, nome: ' ' })).toMatchObject({ ok: false, erro: expect.stringContaining('Nome da fonte') });
    expect(montarFonteRapida({ ...fonte, nome: 'x'.repeat(121) })).toMatchObject({ ok: false });
    expect(montarFonteRapida({ ...fonte, tipo: 'blog' })).toMatchObject({ ok: false, erro: expect.stringContaining('Tipo') });
    expect(montarFonteRapida({ ...fonte, licenca: 'livre' })).toMatchObject({ ok: false, erro: expect.stringContaining('Licença') });
    expect(montarFonteRapida({ ...fonte, editoria: '' })).toMatchObject({ ok: false, erro: expect.stringContaining('Editoria') });
  });
});

describe('montarEvidencia', () => {
  const ev = { chave: 'ev-9f8e7d6c', articleId: 'mat-1', url: 'https://www.banco.com.br/imprensa/nota', trecho: 'O banco reduziu a tarifa.' };
  it('aceita com ou sem fonte', () => {
    expect(montarEvidencia(ev)).toEqual({ ok: true, corpo: ev });
    expect(montarEvidencia({ ...ev, sourceId: 'rapida-ab12cd34' })).toMatchObject({ ok: true, corpo: { sourceId: 'rapida-ab12cd34' } });
  });
  it('trecho: obrigatório e até 500 caracteres (conta exata na mensagem)', () => {
    expect(montarEvidencia({ ...ev, trecho: '   ' })).toMatchObject({ ok: false, erro: expect.stringContaining('cole o trecho') });
    expect(montarEvidencia({ ...ev, trecho: 'a'.repeat(TRECHO_MAX) }).ok).toBe(true);
    expect(montarEvidencia({ ...ev, trecho: 'a'.repeat(TRECHO_MAX + 1) })).toMatchObject({ ok: false, erro: expect.stringContaining('há 501') });
  });
  it('exige matéria salva e URL https', () => {
    expect(montarEvidencia({ ...ev, articleId: '' })).toMatchObject({ ok: false, erro: expect.stringContaining('Salve o rascunho') });
    expect(montarEvidencia({ ...ev, url: 'ftp://x.com/a' })).toMatchObject({ ok: false, erro: expect.stringContaining('URL da evidência') });
  });
});

describe('mensagemDoCodigo', () => {
  it('SOURCE_EXISTS aponta a fonte já cadastrada', () => {
    const m = mensagemDoCodigo('SOURCE_EXISTS', { id: 'rapida-aa11bb22' }, 'x', 'Sala de imprensa do Banco');
    expect(m).toContain('Sala de imprensa do Banco');
    expect(m).not.toContain('rapida-aa11bb22'); // o código interno não aparece para a pessoa
    expect(mensagemDoCodigo('SOURCE_EXISTS', undefined, 'x')).toContain('já está cadastrada');
  });
  it('matéria fora de rascunho, fonte inexistente, idempotência e padrão', () => {
    expect(mensagemDoCodigo('ARTICLE_NOT_DRAFT', undefined, 'x')).toContain('rascunho');
    expect(mensagemDoCodigo('SOURCE_NOT_FOUND', undefined, 'x')).toContain('fonte escolhida');
    expect(mensagemDoCodigo('IDEMPOTENCY_MISMATCH', undefined, 'x')).toContain('Recarregue');
    expect(mensagemDoCodigo('OUTRO', undefined, 'mensagem padrão')).toBe('mensagem padrão');
  });
});
