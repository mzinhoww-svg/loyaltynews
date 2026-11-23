import { describe, expect, it } from 'vitest';
import { canonicalPublishedContent, isEnabled, type PublishableContent } from './index';
import { publishedContentSha256 } from './hash';

const base: PublishableContent = {
  titulo: 'Programa X muda regra', resumo: 'Resumo.', tipoConteudo: 'noticia', editoria: 'pontos', corpo: 'Texto.\n\nFontes: ...',
  imagem: { url: 'https://example.org/i.jpg', baseDeDireito: 'propria' }, classeDeDado: 'public', patrocinado: false, fontes: ['ev-2', 'ev-1'],
};

describe('hash do conteúdo publicado (ADR-017)', () => {
  it('determinístico e independente da ordem das fontes e das chaves', () => {
    const a = publishedContentSha256(base);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(publishedContentSha256({ ...base, fontes: ['ev-1', 'ev-2'] })).toBe(a);
    expect(canonicalPublishedContent(base).startsWith('ln-published-content/1\n')).toBe(true);
  });
  it('muda quando muda qualquer campo publicado, não só o corpo', () => {
    const a = publishedContentSha256(base);
    for (const alt of [{ titulo: 'Outro título' }, { resumo: 'Outro' }, { imagem: { url: 'https://example.org/i.jpg', baseDeDireito: 'pendente' } }, { rotuloPublieditorial: 'Patrocinado' }, { fontes: ['ev-1'] }]) {
      expect(publishedContentSha256({ ...base, ...alt })).not.toBe(a);
    }
  });
  it('subtítulo ausente e null são equivalentes', () => {
    expect(publishedContentSha256({ ...base, subtitulo: null })).toBe(publishedContentSha256(base));
  });
});

describe('flag de publicação pelo portal (ADR-017, decisão 1)', () => {
  it('publicacaoPortal existe e nasce desligada, separada de publicacaoAutonoma', () => {
    expect(isEnabled('publicacaoPortal')).toBe(false);
    expect(isEnabled('publicacaoAutonoma')).toBe(false);
  });
});

describe('flag do adaptador OpenBot (ADR-003, R2-10)', () => {
  it('openbotDispatch existe e nasce desligada; só override explícito liga', () => {
    expect(isEnabled('openbotDispatch')).toBe(false);
    expect(isEnabled('openbotDispatch', { openbotDispatch: true })).toBe(true);
  });
});
