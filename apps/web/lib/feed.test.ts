import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O require condicional das fixtures (R8) não resolve .ts no Vitest; o teste troca a fonte por uma dublê controlada.
const getLatest = vi.fn();
let kind: 'mock' | 'empty' | 'api' = 'mock';
vi.mock('../app/(portal)/_lib/source', () => ({ getSource: () => ({ kind, getLatest }) }));

import { GET } from '../app/(portal)/feed.xml/route';

const article = { slug: 'x', title: '[MOCK] Matéria de teste', summary: 'Resumo MOCK', publishedAt: '2026-11-20T10:00:00-03:00' };

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  getLatest.mockReset();
  getLatest.mockResolvedValue({ items: [article], page: 1, pageSize: 30, total: 1 });
});

describe('feed.xml (Security R6: vitrine fora do feed)', () => {
  it('fonte MOCK/vitrine: canal RSS válido, nunca consulta a fonte e não tem item nem marcador de demonstração', async () => {
    kind = 'mock';
    const res = await GET();
    expect(res.headers.get('content-type')).toContain('application/rss+xml');
    const body = await res.text();
    expect(body).toContain('<rss version="2.0">');
    expect(body).not.toContain('<item>');
    expect(body).not.toMatch(/\[MOCK\]|demonstra/i);
    expect(getLatest).not.toHaveBeenCalled();
  });

  it('fonte real (api) em produção INDEXÁVEL: publica um item por matéria', async () => {
    kind = 'api';
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('PORTAL_INDEXAVEL', '1');
    const body = await (await GET()).text();
    expect(body.match(/<item>/g)).toHaveLength(1);
    expect(getLatest).toHaveBeenCalledWith({ pageSize: 30 });
  });

  it('produção SEM PORTAL_INDEXAVEL=1 (pré-go-live): feed sem itens e sem consultar a fonte, como o sitemap', async () => {
    kind = 'api';
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('PORTAL_INDEXAVEL', '');
    const body = await (await GET()).text();
    expect(body).toContain('<rss version="2.0">');
    expect(body).not.toContain('<item>');
    expect(getLatest).not.toHaveBeenCalled();
    for (const v of ['0', 'true']) {
      vi.stubEnv('PORTAL_INDEXAVEL', v);
      expect(await (await GET()).text()).not.toContain('<item>');
    }
  });

  it('staging, mesmo com a variável, também sai sem itens', async () => {
    kind = 'api';
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('PORTAL_INDEXAVEL', '1');
    expect(await (await GET()).text()).not.toContain('<item>');
    expect(getLatest).not.toHaveBeenCalled();
  });

  it('fonte vazia: canal sem itens', async () => {
    kind = 'empty';
    getLatest.mockResolvedValue({ items: [], page: 1, pageSize: 30, total: 0 });
    expect(await (await GET()).text()).not.toContain('<item>');
  });
});
