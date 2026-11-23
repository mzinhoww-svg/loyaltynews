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

describe('fonte de dados por ambiente (sem abrir caminho para mock em deploy)', () => {
  it('api vale em staging e em produção, sem cair em mock', () => {
    for (const APP_ENV of ['staging', 'production', 'producao', 'homologacao', undefined]) {
      expect(resolveSourceKind({ APP_ENV, PORTAL_SOURCE: 'api', NODE_ENV: 'production' })).toEqual({ kind: 'api', refusedMock: false });
    }
  });
  it('PORTAL_SOURCE=mock só em desenvolvimento/teste ou no build de e2e; em deploy (inclusive staging) é recusado', () => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      expect(resolveSourceKind({ APP_ENV: 'staging', PORTAL_SOURCE: 'mock', NODE_ENV }).kind).toBe('mock');
    }
    expect(resolveSourceKind({ APP_ENV: 'staging', PORTAL_SOURCE: 'mock', NODE_ENV: 'production' })).toEqual({ kind: 'empty', refusedMock: true });
    expect(resolveSourceKind({ APP_ENV: 'staging', PORTAL_SOURCE: 'mock', NODE_ENV: 'production', LN_E2E_BUILD: '1' }).kind).toBe('mock');
  });
  it('produção e producao nunca ativam mock, nem com LN_E2E_BUILD ou vitrine', () => {
    for (const APP_ENV of ['production', 'producao']) {
      for (const extra of [{ PORTAL_SOURCE: 'mock' }, { PORTAL_SOURCE: 'mock', LN_E2E_BUILD: '1' }, { PORTAL_VITRINE: '1' }, { PORTAL_VITRINE: '1', PORTAL_SOURCE: 'mock' }]) {
        expect(resolveSourceKind({ APP_ENV, NODE_ENV: 'development', ...extra })).toEqual({ kind: 'empty', refusedMock: true });
      }
    }
  });
  it('vitrine: só PORTAL_VITRINE=1 com APP_ENV=staging', () => {
    expect(resolveSourceKind({ APP_ENV: 'staging', PORTAL_VITRINE: '1', NODE_ENV: 'production' })).toEqual({ kind: 'mock', refusedMock: false });
    for (const v of ['0', 'true', 'yes', ' 1']) {
      expect(resolveSourceKind({ APP_ENV: 'staging', PORTAL_VITRINE: v, NODE_ENV: 'production' })).toEqual({ kind: 'empty', refusedMock: true });
    }
    for (const APP_ENV of ['homologacao', 'development', undefined]) {
      expect(resolveSourceKind({ APP_ENV, PORTAL_VITRINE: '1', NODE_ENV: 'production' })).toEqual({ kind: 'empty', refusedMock: true });
    }
  });
  it('valor desconhecido ou ausente é fonte vazia', () => {
    for (const PORTAL_SOURCE of [undefined, '', 'intelligence', 'MOCK', 'mock ', 'api ']) {
      expect(resolveSourceKind({ APP_ENV: 'production', PORTAL_SOURCE }).kind).toBe('empty');
    }
  });
  it('vitrine pedida bloqueia indexação em qualquer ambiente', () => {
    expect(indexingBlocked({ APP_ENV: 'production', PORTAL_VITRINE: '1' })).toBe(true);
  });
});
