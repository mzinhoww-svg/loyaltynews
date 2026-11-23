import { describe, expect, it } from 'vitest';
import { NOINDEX_HEADER, indexingBlocked, isProductionEnv, resolveSiteUrl, resolveSourceKind, robotsTxt } from '../app/(portal)/_lib/indexing';

describe('política de indexação por APP_ENV', () => {
  it('só production libera indexação', () => {
    expect(isProductionEnv({ APP_ENV: 'production' })).toBe(true);
    for (const e of ['staging', 'homologacao', 'development', 'test', '', undefined]) {
      expect(indexingBlocked({ APP_ENV: e })).toBe(true);
    }
    expect(indexingBlocked({ APP_ENV: 'production' })).toBe(false);
  });
  it('fonte MOCK bloqueia mesmo em production', () => {
    expect(indexingBlocked({ APP_ENV: 'production', PORTAL_SOURCE: 'mock' })).toBe(true);
  });
  it('sem APP_ENV o padrão é bloquear', () => {
    expect(indexingBlocked({})).toBe(true);
  });
  it('cabeçalho', () => {
    expect(NOINDEX_HEADER).toBe('noindex, nofollow');
  });
});

describe('robots.txt', () => {
  it('bloqueado: Disallow total e sem Sitemap', () => {
    expect(robotsTxt(true, 'https://x.test')).toBe('User-agent: *\nDisallow: /\n');
  });
  it('produção: libera, protege busca/studio/api e aponta o sitemap', () => {
    const t = robotsTxt(false, 'https://x.test');
    expect(t).toContain('Allow: /');
    expect(t).toContain('Disallow: /busca');
    expect(t).toContain('Disallow: /studio');
    expect(t).toContain('Sitemap: https://x.test/sitemap.xml');
  });
});

describe('NEXT_PUBLIC_SITE_URL', () => {
  const build = { NEXT_PHASE: 'phase-production-build' };
  it('produção: o build falha sem a variável', () => {
    expect(() => resolveSiteUrl({ ...build, APP_ENV: 'production' })).toThrow(/NEXT_PUBLIC_SITE_URL/);
    expect(() => resolveSiteUrl({ ...build, APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: '  ' })).toThrow();
  });
  it('produção: recusa localhost e URL inválida', () => {
    expect(() => resolveSiteUrl({ ...build, APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toThrow(/localhost/);
    expect(() => resolveSiteUrl({ ...build, APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'não é url' })).toThrow(/inválida/);
    expect(() => resolveSiteUrl({ ...build, APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'ftp://x.test' })).toThrow(/http/);
  });
  it('produção com URL válida: normaliza sem barra final', () => {
    expect(resolveSiteUrl({ ...build, APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://loyaltynews.example/' })).toBe('https://loyaltynews.example');
  });
  it('staging: usa a URL do staging ou cai em localhost sem falhar', () => {
    expect(resolveSiteUrl({ ...build, APP_ENV: 'staging', NEXT_PUBLIC_SITE_URL: 'https://staging.example' })).toBe('https://staging.example');
    expect(resolveSiteUrl({ ...build, APP_ENV: 'staging' })).toBe('http://localhost:3000');
    expect(resolveSiteUrl({})).toBe('http://localhost:3000');
  });
  it('em execução (fora do build) não lança por falta da variável', () => {
    expect(resolveSiteUrl({ APP_ENV: 'production' })).toBe('http://localhost:3000');
  });
});

describe('fonte de dados por ambiente (sem abrir caminho para mock em produção)', () => {
  it('api vale em staging e em produção, sem cair em mock', () => {
    for (const APP_ENV of ['staging', 'production', 'homologacao', undefined]) {
      expect(resolveSourceKind({ APP_ENV, PORTAL_SOURCE: 'api' })).toEqual({ kind: 'api', refusedMock: false });
    }
  });
  it('mock vale fora de produção', () => {
    for (const APP_ENV of ['staging', 'development', 'homologacao', undefined]) {
      expect(resolveSourceKind({ APP_ENV, PORTAL_SOURCE: 'mock' })).toEqual({ kind: 'mock', refusedMock: false });
    }
  });
  it('mock em produção é recusado (vira fonte vazia); só o build de e2e o aceita', () => {
    expect(resolveSourceKind({ APP_ENV: 'production', PORTAL_SOURCE: 'mock' })).toEqual({ kind: 'empty', refusedMock: true });
    expect(resolveSourceKind({ APP_ENV: 'production', PORTAL_SOURCE: 'mock', LN_E2E_BUILD: '1' })).toEqual({ kind: 'mock', refusedMock: false });
    expect(resolveSourceKind({ APP_ENV: 'production', PORTAL_SOURCE: 'mock', LN_E2E_BUILD: '0' }).kind).toBe('empty');
  });
  it('valor desconhecido ou ausente é fonte vazia', () => {
    for (const PORTAL_SOURCE of [undefined, '', 'intelligence', 'MOCK', 'mock ', 'api ']) {
      expect(resolveSourceKind({ APP_ENV: 'production', PORTAL_SOURCE }).kind).toBe('empty');
    }
  });
});
