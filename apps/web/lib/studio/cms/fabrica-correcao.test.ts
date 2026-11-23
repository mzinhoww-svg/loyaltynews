import { describe, expect, it } from 'vitest';
import { modeloDaChecagem, modeloDoRascunho, montarCorrecao } from './fabrica-correcao';

describe('montarCorrecao', () => {
  it('monta {casoId, draft, factcheck} de dois JSONs de objeto', () => {
    const r = montarCorrecao(' caso-1 ', '{"headline":"T"}', '{"provider":"p"}');
    expect(r).toEqual({ ok: true, correcao: { casoId: 'caso-1', draft: { headline: 'T' }, factcheck: { provider: 'p' } } });
  });
  it('recusa sem caso, JSON vazio, quebrado e que não seja objeto, dizendo qual campo', () => {
    expect(montarCorrecao('', '{}', '{}')).toMatchObject({ ok: false, erro: expect.stringContaining('caso') });
    expect(montarCorrecao('c', '', '{}')).toMatchObject({ ok: false, erro: expect.stringContaining('Rascunho corrigido: informe') });
    expect(montarCorrecao('c', '{x', '{}')).toMatchObject({ ok: false, erro: expect.stringContaining('Rascunho corrigido: JSON inválido') });
    expect(montarCorrecao('c', '[]', '{}')).toMatchObject({ ok: false, erro: expect.stringContaining('objeto') });
    expect(montarCorrecao('c', '{}', 'null')).toMatchObject({ ok: false, erro: expect.stringContaining('Checagem') });
  });
});

describe('modelos de partida (nada inventado)', () => {
  const materia = { slug: 'programa-alfa', editoria: 'pontos', subtitulo: null, resumo: 'Resumo', tipoConteudo: 'noticia', patrocinado: false, rotuloPublieditorial: null };
  const revisao = {
    rascunho: { titulo: 'Título', corpo: 'Corpo.', assinatura: 'Redação', imagem: { mode: 'none', reason: 'sem imagem' }, claims: [{ id: 'c1', kind: 'fact', text: 'afirmação', evidenceIds: ['e1'] }] },
    evidencias: [{ id: 'e1' }],
  };
  it('preenche só o que as rotas de leitura expõem e deixa em branco o que elas não expõem', () => {
    const m = modeloDoRascunho(materia, revisao);
    expect(m).toMatchObject({ editoria: 'pontos', headline: 'Título', body: 'Corpo.', slug: 'programa-alfa', signature: 'Redação', evidenceIds: ['e1'] });
    expect(m).toMatchObject({ id: '', classeDeDado: '', modelProvider: '', promptVersion: '' });
    expect(m).not.toHaveProperty('subtitulo');
    expect(JSON.stringify(m)).not.toContain('Avisos:');
  });
  it('checagem em branco: um veredito vazio por afirmação, sem provedor', () => {
    expect(modeloDaChecagem(['c1', 'c2'])).toEqual({ provider: '', model: '', verdicts: [{ claimId: 'c1', verdict: '' }, { claimId: 'c2', verdict: '' }] });
  });
  it('sem rascunho editorial devolve campos vazios, não dados fictícios', () => {
    const m = modeloDoRascunho(materia, { rascunho: null, evidencias: [] });
    expect(m).toMatchObject({ headline: '', body: '', claims: [], evidenceIds: [], signature: '' });
  });
});
