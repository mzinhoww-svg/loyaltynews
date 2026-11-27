import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapArticle, type RawArticle } from '../app/(portal)/_lib/api-source';
import { mockSource } from '../app/(portal)/_lib/fixtures/portal.mock';
import { createIntelligenceSlice } from '../app/(portal)/_lib/intelligence-source';
import type { PortalSource } from '../app/(portal)/_lib/types';
import EmpresaPage from '../app/(portal)/intelligence/empresas/[id]/page';
import IntelligenceHub from '../app/(portal)/intelligence/page';
import ArticlePage from '../app/(portal)/noticia/[slug]/page';
import sitemap from '../app/(portal)/sitemap';

/** Achados N3, N4 e N6 de auditoria-design/estado-honesto-portal-2026-11-26.md (int/038-v7 9186d8f1). */
const fonteAtual = vi.hoisted(() => ({ src: undefined as unknown }));
vi.mock('../app/(portal)/_lib/source', () => ({ getSource: () => fonteAtual.src as PortalSource }));
// Barra lateral e anúncios são componentes assíncronos de outra frente: não fazem parte do que se prova aqui.
vi.mock('../app/(portal)/_components/Sidebar', () => ({ WithSidebar: ({ children }: { children: ReactNode }) => children }));
vi.mock('../app/(portal)/_components/ui', async (original) => ({ ...(await original<object>()), AdSlot: () => null }));

const ID = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fonte = { nome: 'Fonte de teste', url: 'https://fonte.invalid/p', coletadoEm: '2026-11-23T12:00:00.000Z' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** API falsa com paginação real de /empresas (limit/offset), como a rota pública. `falhaNoOffset` responde 503 naquela página. */
function api({ empresas = 0, falhaNoOffset = -1, moves = 200 } = {}) {
  return createIntelligenceSlice('http://api.invalid', async (entrada) => {
    const u = new URL(String(entrada));
    if (u.pathname.endsWith('/empresas')) {
      const limit = Number(u.searchParams.get('limit') ?? 100);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      if (offset === falhaNoOffset) return json(503, {});
      const data = Array.from({ length: Math.max(0, Math.min(limit, empresas - offset)) }, (_, i) => ({
        id: ID(offset + i + 1), nome: `Org ${offset + i + 1}`, nomeLegal: `Org ${offset + i + 1}`, tipo: 'company', relacoes: 0, validadoEm: fonte.coletadoEm, mock: false,
      }));
      return json(200, { data, total: empresas, tipos: [{ tipo: 'company', total: empresas }] });
    }
    if (u.pathname.endsWith(`/empresas/${ID(1)}`)) {
      return json(200, { data: { id: ID(1), nome: 'Org 1', nomeLegal: 'Org 1', tipo: 'company', fonte, relacoes: [], pessoas: { disponivel: false, itens: [] } } });
    }
    if (u.pathname.endsWith('/moves')) return json(moves, moves === 200 ? { data: [], total: 0, disponivel: false } : {});
    return json(200, { data: [], total: 0, disponivel: false });
  });
}

const portal = (intel: ReturnType<typeof api>, extra: Partial<PortalSource> = {}) => ({
  ...intel,
  kind: 'api',
  getSiteConfig: async () => null,
  getLatest: async () => ({ items: [], page: 1, pageSize: 100, total: 0 }),
  listEvents: async () => ({ items: [] }),
  ...extra,
});

let erro: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  erro = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  erro.mockRestore();
  vi.unstubAllEnvs();
});

describe('N3: todos os perfis de empresa, não só a primeira página', () => {
  const urlsDeEmpresa = async () => {
    vi.stubEnv('APP_ENV', 'production');
    return (await sitemap()).map((e) => e.url).filter((u) => u.includes('/intelligence/empresas/'));
  };

  it.each([24, 29, 61])('sitemap lista os %i perfis, sem repetir', async (total) => {
    fonteAtual.src = portal(api({ empresas: total }));
    const urls = await urlsDeEmpresa();
    expect(urls).toHaveLength(total);
    expect(new Set(urls).size).toBe(total);
  });

  it('o hub conta todas as empresas', async () => {
    fonteAtual.src = portal(api({ empresas: 29 }));
    const html = renderToStaticMarkup(await IntelligenceHub());
    expect(html).toMatch(/data-testid="count-empresas"[^>]*>29 cadastrado/);
  });

  it('falha em uma página seguinte não vira lista parcial apresentada como completa', async () => {
    fonteAtual.src = portal(api({ empresas: 29, falhaNoOffset: 24 }));
    expect(await urlsDeEmpresa()).toHaveLength(0);
  });
});

describe('N4: falha de Moves no perfil da empresa aparece', () => {
  const perfil = async (moves: number) => {
    fonteAtual.src = portal(api({ moves }));
    return renderToStaticMarkup(await EmpresaPage({ params: Promise.resolve({ id: ID(1) }) }));
  };

  it('503 = aviso de indisponível com nova tentativa', async () => {
    const html = await perfil(503);
    expect(html).toContain('Movimentações temporariamente indisponíveis');
    expect(html).toContain(`href="/intelligence/empresas/${ID(1)}"`);
  });

  it('sem movimentação publicada: nem seção nem aviso de falha', async () => {
    const html = await perfil(200);
    expect(html).not.toContain('Movimentações');
  });
});

describe('N6: a data ao lado da fonte da matéria diz o que é', () => {
  const materia = async (sources: unknown) => {
    const base = (await mockSource.getLatest({ pageSize: 1 })).items[0]!;
    const { article } = await mockSource.getArticle(base.slug);
    fonteAtual.src = { ...mockSource, getArticle: async () => ({ article: { ...article!, sources } }), getRelated: async () => [], getSiteConfig: async () => null };
    const html = renderToStaticMarkup(await ArticlePage({ params: Promise.resolve({ slug: `${base.slug}` }) }));
    return html.match(/<section class="pt-sources".*?<\/ul>/s)![0];
  };
  const daApi = (capturadoEm?: string) => mapArticle({
    slug: 'materia-teste', titulo: 'Matéria de teste', resumo: 'Resumo', editoria: 'bancos', tipoConteudo: 'news', assinatura: 'Redação',
    publicadoEm: '2026-11-20T10:00:00-03:00', corpo: 'Texto.', fontes: [{ url: 'https://fonte.invalid/a', capturadoEm }],
  } as unknown as RawArticle).sources;

  it('data vinda da API (capturadoEm) é rotulada como coleta', async () => {
    const html = await materia(daApi('2026-11-19T10:00:00-03:00'));
    expect(html).toMatch(/coletada em <time dateTime="2026-11-19T10:00:00-03:00">19 de novembro de 2026<\/time>/);
    expect(html).not.toMatch(/publicad/i);
  });

  it('sem data de coleta não há rótulo solto', async () => {
    const html = await materia(daApi());
    expect(html).not.toContain('coletada');
    expect(html).not.toContain('<time');
  });
});
