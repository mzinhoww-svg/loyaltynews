import { describe, expect, it } from 'vitest';
import { EDITORIAS, getEditoria } from '../app/(portal)/_lib/editorias';
import { emptySource } from '../app/(portal)/_lib/empty-source';
import { mockSource } from '../app/(portal)/_lib/fixtures/portal.mock';
import { formatDate, normalize } from '../app/(portal)/_lib/format';
import { INFO_DOCS, INFO_SLUGS } from '../app/(portal)/_lib/institutional';

describe('editorias', () => {
  it('são exatamente dez, com slugs únicos e descrição', () => {
    expect(EDITORIAS).toHaveLength(10);
    expect(new Set(EDITORIAS.map((e) => e.slug)).size).toBe(10);
    for (const e of EDITORIAS) {
      expect(e.description.length).toBeGreaterThan(10);
      expect(getEditoria(e.slug)?.name).toBe(e.name);
    }
  });
});

describe('fonte vazia (padrão)', () => {
  it('não devolve conteúdo inventado', async () => {
    expect(await emptySource.getHighlights()).toEqual([]);
    expect(await emptySource.getTrending('24h')).toEqual([]);
    expect((await emptySource.getLatest()).total).toBe(0);
    expect(await emptySource.getArticle('x')).toEqual({ article: null });
    expect((await emptySource.search('loyalty')).items).toEqual([]);
    expect(await emptySource.listEvents()).toEqual({ items: [] });
    expect(await emptySource.listMoves()).toEqual([]);
    expect(await emptySource.getAd('topo')).toBeNull();
  });
  it('audiência nunca tem valor numérico sem coleta', async () => {
    const a = await emptySource.getAudience();
    for (const m of [...a.realtime, ...a.historical]) {
      expect(m.value).toBeNull();
      expect(m.state).toBe('unavailable');
    }
  });
});

describe('fonte MOCK', () => {
  it('marca todos os itens como mock e nunca traz audiência numérica', async () => {
    const all = (await mockSource.getLatest({ pageSize: 100 })).items;
    expect(all.length).toBe(20);
    expect(all.every((a) => a.mock && a.title.includes('MOCK'))).toBe(true);
    expect((await mockSource.listEvents()).items.every((e) => e.mock)).toBe(true);
    const a = await mockSource.getAudience();
    expect([...a.realtime, ...a.historical].every((m) => m.value === null)).toBe(true);
  });
  it('filtra por editoria e tipo e pagina', async () => {
    const ed = await mockSource.getLatest({ editoriaSlug: 'bancos' });
    expect(ed.items).toHaveLength(2);
    const p1 = await mockSource.getLatest({ page: 1, pageSize: 12 });
    const p2 = await mockSource.getLatest({ page: 2, pageSize: 12 });
    expect(p1.items).toHaveLength(12);
    expect(p2.items).toHaveLength(8);
  });
  it('busca ignora acentos e caixa', async () => {
    expect((await mockSource.search('BANCOS')).total).toBeGreaterThan(0);
    expect((await mockSource.search('   ')).total).toBe(0);
    expect((await mockSource.search('zzzz-nada')).total).toBe(0);
  });
  it('relacionadas não incluem a própria matéria', async () => {
    const a = (await mockSource.getArticle('mock-bancos-1')).article!;
    const rel = await mockSource.getRelated(a, 3);
    expect(rel).toHaveLength(3);
    expect(rel.some((r) => r.slug === a.slug)).toBe(false);
  });
});

describe('formatação', () => {
  it('usa fuso de Brasília', () => {
    expect(formatDate('2026-11-22T01:30:00Z', { day: '2-digit', month: '2-digit' })).toBe('21/11');
  });
  it('normaliza acentos', () => {
    expect(normalize('Regulação & Dados')).toBe('regulacao & dados');
  });
});

describe('institucionais', () => {
  it('cobrem todas as páginas linkadas no rodapé e a minuta jurídica é marcada', () => {
    for (const s of ['sobre', 'metodologia', 'politica-editorial', 'correcoes', 'privacidade', 'termos', 'publicidade', 'contato']) {
      expect(INFO_SLUGS).toContain(s);
    }
    for (const s of ['privacidade', 'termos', 'publicidade']) expect(INFO_DOCS[s]?.draftNotice).toMatch(/validação jurídica/);
  });
  it('não inventa e-mail nem redes: o único e-mail é o da DP-54 (contato@loyaltynews.com.br)', () => {
    const text = JSON.stringify(INFO_DOCS);
    expect(text.replace(/contato@loyaltynews\.com\.br/g, '')).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/linkedin\.com|instagram\.com|wa\.me/i);
  });
});
