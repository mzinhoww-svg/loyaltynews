import { describe, expect, it } from 'vitest';
import { estadoDaPauta, fontesDeAncora, montarPauta, slugDoTitulo, urlCaiNaFonte, type FonteRegistro, type PautaEntrada, type PautaVista } from './pauta';

const fonte = (over: Partial<FonteRegistro> = {}): FonteRegistro => ({ id: 'azul-ri', nome: 'Azul RI', kind: 'ri', host: 'ri.voeazul.com.br', pathPrefix: '/comunicados', habilitada: true, elegivel: true, ...over });
const permitidas = [fonte(), fonte({ id: 'gol-ri', nome: 'Gol RI', host: 'ri.voegol.com.br', pathPrefix: null })];
const entrada = (over: Partial<PautaEntrada> = {}): PautaEntrada => ({
  id: '',
  titulo: 'Como a Azul mudou a regra de pontos',
  angulo: 'Compara o comunicado da Azul com o da Gol sobre pontos.',
  formato: 'comparativo',
  editoria: 'pontos',
  ancoras: [
    { fonteId: 'azul-ri', url: 'https://ri.voeazul.com.br/comunicados/a' },
    { fonteId: 'gol-ri', url: 'https://ri.voegol.com.br/qualquer/b' },
  ],
  ...over,
});

describe('fontesDeAncora', () => {
  it('só primárias habilitadas e elegíveis', () => {
    const todas = [fonte(), fonte({ id: 'b', habilitada: false }), fonte({ id: 'c', elegivel: false }), fonte({ id: 'd', kind: 'blog' })];
    expect(fontesDeAncora(todas, (k) => k !== 'blog').map((f) => f.id)).toEqual(['azul-ri']);
  });
});

describe('urlCaiNaFonte', () => {
  it('mesmo host, https e prefixo de caminho', () => {
    const f = fonte();
    expect(urlCaiNaFonte(f, 'https://ri.voeazul.com.br/comunicados/x')).toBe(true);
    expect(urlCaiNaFonte(f, 'https://ri.voeazul.com.br/comunicados')).toBe(true);
    expect(urlCaiNaFonte(f, 'https://ri.voeazul.com.br/comunicadosx')).toBe(false);
    expect(urlCaiNaFonte(f, 'https://ri.voeazul.com.br/outro')).toBe(false);
    expect(urlCaiNaFonte(f, 'http://ri.voeazul.com.br/comunicados/x')).toBe(false);
    expect(urlCaiNaFonte(f, 'https://outro.com.br/comunicados/x')).toBe(false);
    expect(urlCaiNaFonte(f, 'não é url')).toBe(false);
  });
});

describe('slugDoTitulo', () => {
  it('minúsculas, sem acento, hífens, até 64', () => {
    expect(slugDoTitulo('Como a Azul mudou: regra de pontos!')).toBe('como-a-azul-mudou-regra-de-pontos');
    expect(slugDoTitulo('Análise ÇÃO')).toBe('analise-cao');
    expect(slugDoTitulo('x'.repeat(100)).length).toBe(64);
  });
});

describe('montarPauta', () => {
  it('monta o corpo do POST com id do título e as URLs na ordem', () => {
    const r = montarPauta(entrada(), permitidas);
    expect(r).toEqual({
      ok: true,
      corpo: { id: 'como-a-azul-mudou-a-regra-de-pontos', titulo: 'Como a Azul mudou a regra de pontos', angulo: 'Compara o comunicado da Azul com o da Gol sobre pontos.', formato: 'comparativo', editoria: 'pontos', ancoras: ['https://ri.voeazul.com.br/comunicados/a', 'https://ri.voegol.com.br/qualquer/b'] },
    });
  });
  it('linha sem URL é ignorada; menos de 2 âncoras é recusado dizendo quantas há', () => {
    const r = montarPauta(entrada({ ancoras: [{ fonteId: 'azul-ri', url: 'https://ri.voeazul.com.br/comunicados/a' }, { fonteId: 'gol-ri', url: ' ' }] }), permitidas);
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining('há 1') });
  });
  it('recusa: fonte não permitida, URL fora da fonte, repetida, mais de 8, campos curtos', () => {
    expect(montarPauta(entrada({ ancoras: [{ fonteId: 'azul-ri', url: 'https://ri.voeazul.com.br/comunicados/a' }, { fonteId: 'x', url: 'https://x.com/y' }] }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('Âncora 2') });
    expect(montarPauta(entrada({ ancoras: [{ fonteId: 'azul-ri', url: 'https://ri.voeazul.com.br/comunicados/a' }, { fonteId: 'gol-ri', url: 'https://ri.voeazul.com.br/comunicados/b' }] }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('ri.voegol.com.br') });
    expect(montarPauta(entrada({ ancoras: [{ fonteId: 'azul-ri', url: 'https://ri.voeazul.com.br/comunicados/a' }, { fonteId: 'azul-ri', url: 'https://ri.voeazul.com.br/comunicados/a' }] }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('repetida') });
    const nove = Array.from({ length: 9 }, (_, i) => ({ fonteId: 'gol-ri', url: `https://ri.voegol.com.br/p${i}` }));
    expect(montarPauta(entrada({ ancoras: nove }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('no máximo 8') });
    expect(montarPauta(entrada({ titulo: 'curto' }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('Título') });
    expect(montarPauta(entrada({ angulo: 'curto' }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('Ângulo') });
    expect(montarPauta(entrada({ formato: 'noticia' }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('formato') });
    expect(montarPauta(entrada({ id: 'Id Inválido!' }), permitidas)).toMatchObject({ ok: false, erro: expect.stringContaining('Identificador') });
  });
});

describe('estadoDaPauta', () => {
  const base: PautaVista = { id: 'p', titulo: 't', angulo: 'a', formato: 'analise', editoria: 'pontos', ancoras: [], submetidaPor: 'u', em: '2026-11-23T10:00:00Z', estado: 'pendente' };
  it('fila, aprovada, bloqueada e outro', () => {
    expect(estadoDaPauta(base).chave).toBe('fila');
    expect(estadoDaPauta({ ...base, estado: 'processada', resultado: { status: 'aprovado', articleId: 'aut_1', blockers: [], findings: [], em: 'x' } }).chave).toBe('aprovada');
    expect(estadoDaPauta({ ...base, estado: 'processada', resultado: { status: 'bloqueado', articleId: null, blockers: ['x'], findings: [], em: 'x' } }).chave).toBe('bloqueada');
    expect(estadoDaPauta({ ...base, estado: 'processada', resultado: { status: 'ja_existe', articleId: null, blockers: [], findings: [], em: 'x' } })).toMatchObject({ chave: 'outro', rotulo: 'Processada: ja_existe' });
  });
});
