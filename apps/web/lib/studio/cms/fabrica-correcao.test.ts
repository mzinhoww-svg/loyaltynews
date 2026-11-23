import { describe, expect, it } from 'vitest';
import { afirmacoesAlteradas, edicaoInicial, montarCorrecao, type RascunhoFabrica } from './fabrica-correcao';

const base: RascunhoFabrica = {
  articleId: 'a1',
  status: 'publicado',
  versaoPublicada: 1,
  podeCorrigir: true,
  publicacao: null,
  avisos: [],
  rascunho: {
    id: 'rascunho-1',
    editoria: 'pontos',
    slug: 'programa-alfa',
    headline: 'Título',
    subtitulo: 'Sub',
    resumo: 'Resumo',
    tipoConteudo: 'noticia',
    classeDeDado: 'public',
    patrocinado: false,
    body: 'Corpo.\n\nFontes:\n- X: https://x.example',
    claims: [
      { id: 'c1', kind: 'fact', text: 'afirmação um', evidenceIds: ['e1'] },
      { id: 'c2', kind: 'quote', text: 'afirmação dois', evidenceIds: ['e1'], quote: { text: 'fala', speaker: 'Fulano' } },
    ],
    evidenceIds: ['e1'],
    signature: 'Redação',
    image: { mode: 'none', reason: 'sem imagem' },
    modelProvider: 'openai',
    promptVersion: 'p1',
  },
  checagem: { provider: 'anthropic', model: 'm', verdicts: [{ claimId: 'c1', verdict: 'pass' }] },
};

describe('edicaoInicial', () => {
  it('parte do que o Backend devolveu; veredito só onde a última checagem o tem', () => {
    const e = edicaoInicial(base, 'caso-1');
    expect(e).toMatchObject({ casoId: 'caso-1', headline: 'Título', subtitulo: 'Sub', provider: 'anthropic', model: 'm', verdicts: ['pass', ''] });
    expect(e.claimTexts).toEqual(['afirmação um', 'afirmação dois']);
  });
  it('sem checagem anterior nada vem preenchido', () => {
    expect(edicaoInicial({ ...base, checagem: null }, '')).toMatchObject({ provider: '', model: '', verdicts: ['', ''] });
  });
});

describe('montarCorrecao', () => {
  const ok = { ...edicaoInicial(base, 'caso-1'), verdicts: ['pass', 'pass'] };
  it('reenvia o rascunho do Backend com só os textos trocados e a checagem informada', () => {
    const r = montarCorrecao(base, { ...ok, headline: 'Título novo', claimTexts: ['afirmação um corrigida', 'afirmação dois'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.correcao.casoId).toBe('caso-1');
    expect(r.correcao.draft).toMatchObject({ id: 'rascunho-1', slug: 'programa-alfa', classeDeDado: 'public', modelProvider: 'openai', headline: 'Título novo', evidenceIds: ['e1'] });
    expect(r.correcao.draft.claims[0]).toMatchObject({ id: 'c1', text: 'afirmação um corrigida', evidenceIds: ['e1'] });
    expect(r.correcao.draft.claims[1]).toMatchObject({ quote: { text: 'fala', speaker: 'Fulano' } });
    expect(r.correcao.factcheck).toEqual({ provider: 'anthropic', model: 'm', verdicts: [{ claimId: 'c1', verdict: 'pass' }, { claimId: 'c2', verdict: 'pass' }] });
    expect(JSON.stringify(r.correcao)).not.toContain('Avisos:');
  });
  it('subtítulo vazio sai do rascunho', () => {
    const r = montarCorrecao(base, { ...ok, subtitulo: '  ' });
    expect(r.ok && 'subtitulo' in r.correcao.draft).toBe(false);
  });
  it('recusa, dizendo o campo: sem caso, vazios, bloco Avisos, veredito faltando, checagem sem provedor', () => {
    expect(montarCorrecao(base, { ...ok, casoId: '' })).toMatchObject({ ok: false, erro: expect.stringContaining('caso') });
    expect(montarCorrecao(base, { ...ok, headline: ' ' })).toMatchObject({ ok: false, erro: expect.stringContaining('Título') });
    expect(montarCorrecao(base, { ...ok, body: 'x\n\nAvisos:\n- y' })).toMatchObject({ ok: false, erro: expect.stringContaining('Avisos') });
    expect(montarCorrecao(base, { ...ok, claimTexts: ['a', ' '] })).toMatchObject({ ok: false, erro: expect.stringContaining('Afirmação 2') });
    expect(montarCorrecao(base, { ...ok, verdicts: ['pass', ''] })).toMatchObject({ ok: false, erro: expect.stringContaining('afirmação 2') });
    expect(montarCorrecao(base, { ...ok, provider: '' })).toMatchObject({ ok: false, erro: expect.stringContaining('provedor') });
    expect(montarCorrecao(base, { ...ok, claimTexts: ['só uma'] })).toMatchObject({ ok: false, erro: expect.stringContaining('recarregue') });
  });
});

describe('afirmacoesAlteradas', () => {
  it('marca as afirmações com texto mudado (o veredito anterior não vale)', () => {
    expect(afirmacoesAlteradas(base, ['afirmação um', 'dois mudou'])).toEqual([false, true]);
  });
});
