import { describe, expect, it } from 'vitest';
import { AgendaEvent, ARTICLE_TRANSITIONS, ArticleStatus, canTransition, PublicationReceipt } from './index';

describe('transições da matéria', () => {
  it('cobrem todos os estados', () => {
    expect(Object.keys(ARTICLE_TRANSITIONS).sort()).toEqual([...ArticleStatus.options].sort());
  });
  it('publicar só a partir de aprovado', () => {
    for (const s of ArticleStatus.options) expect(canTransition(s, 'publicado')).toBe(s === 'aprovado');
  });
  it('bloqueado não publica nem aprova direto', () => {
    expect(canTransition('bloqueado', 'aprovado')).toBe(false);
    expect(canTransition('bloqueado', 'rascunho')).toBe(true);
  });
});

describe('recibo de publicação', () => {
  it('exige ao menos uma checagem aprovada', () => {
    const r = {
      id: 'r1',
      articleId: 'a1',
      versao: 1,
      conteudoSha256: 'b'.repeat(64),
      checagens: [] as unknown[],
      aprovador: 'gate-automatico',
      identidadePublicacao: 'publisher',
      emitidoEm: '2026-11-22T10:00:00-03:00',
    };
    expect(PublicationReceipt.safeParse(r).success).toBe(false);
    expect(PublicationReceipt.safeParse({ ...r, checagens: [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }] }).success).toBe(true);
    expect(PublicationReceipt.safeParse({ ...r, checagens: [{ tipo: 'fatos', resultado: 'reprovado' }] }).success).toBe(false);
  });
});

describe('agenda', () => {
  it('recusa fim antes do início', () => {
    const e = { id: 'e1', titulo: 'Evento', inicio: '2026-12-02', fim: '2026-12-01', local: 'SP', fonteUrl: 'https://example.org' };
    expect(AgendaEvent.safeParse(e).success).toBe(false);
    expect(AgendaEvent.safeParse({ ...e, fim: '2026-12-03' }).success).toBe(true);
  });
});

import { Article as ArticleSchema, ASSINATURA as SIG, readingTimeMinutes } from './index';
describe('matéria: resumo, tipo de conteúdo e tempo de leitura', () => {
  const ev = { sourceId: 's', url: 'https://example.org/a', capturadoEm: '2026-11-22T10:00:00-03:00', sha256: 'a'.repeat(64) };
  const a = { id: 'a1', slug: 'm', titulo: 'T', editoria: 'pontos', status: 'publicado', assinatura: SIG, corpo: 'C', fontes: [ev], versao: 1 };
  it('publicar exige resumo', () => {
    expect(ArticleSchema.safeParse(a).success).toBe(false);
    expect(ArticleSchema.safeParse({ ...a, resumo: 'Resumo.' }).success).toBe(true);
  });
  it('tipo padrão é notícia; patrocinado exige rótulo', () => {
    expect(ArticleSchema.parse({ ...a, resumo: 'R' }).tipoConteudo).toBe('noticia');
    expect(ArticleSchema.safeParse({ ...a, resumo: 'R', tipoConteudo: 'patrocinado' }).success).toBe(false);
    expect(ArticleSchema.safeParse({ ...a, resumo: 'R', tipoConteudo: 'patrocinado', patrocinado: true, rotuloPublieditorial: 'Conteúdo patrocinado' }).success).toBe(true);
  });
  it('tempo de leitura derivado (200 palavras/min, mínimo 1)', () => {
    expect(readingTimeMinutes('uma frase curta')).toBe(1);
    expect(readingTimeMinutes(Array(401).fill('palavra').join(' '))).toBe(3);
    expect(readingTimeMinutes('<p>**negrito**</p> ' + Array(199).fill('x').join(' '))).toBe(1);
  });
});
