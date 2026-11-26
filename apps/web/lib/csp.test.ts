import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '../proxy';
import { ehDocumento, gerarNonce, modoCsp, politicaCsp } from './csp';

afterEach(() => vi.unstubAllEnvs());

const diretiva = (csp: string, nome: string) => csp.split('; ').find((d) => d.startsWith(`${nome} `))!;
const pedir = (caminho: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`https://portal.example.test${caminho}`, { headers }));
/** Cabeçalho da REQUISIÇÃO que o proxy repassa ao Next (convenção do NextResponse.next). */
const repassado = (res: Response, nome: string) => res.headers.get(`x-middleware-request-${nome}`);

describe('política CSP dos documentos', () => {
  it("script-src exige o nonce e 'strict-dynamic', sem 'unsafe-inline', 'unsafe-eval' nem curinga", () => {
    const s = diretiva(politicaCsp('abc123'), 'script-src');
    expect(s).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://www.googletagmanager.com");
    expect(s).not.toMatch(/unsafe-inline|unsafe-eval|\*|https:(\s|$)/);
  });

  it('mantém as demais travas e aponta o relatório', () => {
    const p = politicaCsp('n');
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'", 'report-uri /api/csp-report', 'report-to csp']) expect(p).toContain(d);
    expect(p).not.toMatch(/[\r\n]/);
  });

  it("'unsafe-eval' só no next dev", () => {
    expect(politicaCsp('n', { dev: true })).toContain("'unsafe-eval'");
    expect(politicaCsp('n')).not.toContain("'unsafe-eval'");
  });

  it('o modo padrão (e para valor desconhecido) é só relatar: bloquear exige "enforce" escrito', () => {
    expect(modoCsp('enforce')).toBe('enforce');
    expect(modoCsp(' ENFORCE ')).toBe('enforce');
    expect(modoCsp('off')).toBe('off');
    for (const v of [undefined, '', 'report', 'enforced', '1', 'true']) expect(modoCsp(v), String(v)).toBe('report');
  });

  it('documento: páginas sim; API, estáticos e arquivos não', () => {
    for (const p of ['/', '/editoria/mercado', '/noticia/uma-materia', '/studio/entrar', '/intelligence/empresas', '/x/y/z']) expect(ehDocumento(p), p).toBe(true);
    for (const p of ['/api/midia/1/arquivo', '/api/csp-report', '/_next/static/chunks/a.js', '/robots.txt', '/sitemap.xml', '/icon.svg']) expect(ehDocumento(p), p).toBe(false);
  });

  it('nonce: 128 bits em base64 e diferente a cada chamada', () => {
    const n = new Set(Array.from({ length: 50 }, gerarNonce));
    expect(n.size).toBe(50);
    for (const x of n) expect(x).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('proxy: cabeçalhos por modo', () => {
  it('padrão: só Report-Only, com o mesmo nonce na requisição repassada ao Next', () => {
    vi.stubEnv('LN_CSP_MODE', '');
    const r = pedir('/');
    const csp = r.headers.get('content-security-policy-report-only')!;
    expect(csp).toContain("'strict-dynamic'");
    expect(r.headers.get('content-security-policy')).toBeNull();
    expect(repassado(r, 'content-security-policy')).toBe(csp);
    expect(r.headers.get('reporting-endpoints')).toBe('csp="/api/csp-report"');
  });

  it('enforce: bloqueia, com nonce novo por requisição', () => {
    vi.stubEnv('LN_CSP_MODE', 'enforce');
    const a = pedir('/studio/entrar').headers.get('content-security-policy')!;
    const b = pedir('/studio/entrar').headers.get('content-security-policy')!;
    expect(a).toContain("'nonce-");
    expect(a).not.toBe(b);
    expect(pedir('/').headers.get('content-security-policy-report-only')).toBeNull();
  });

  it('o nonce e a política que o cliente mandar são descartados', () => {
    for (const modo of ['enforce', 'report', 'off']) {
      vi.stubEnv('LN_CSP_MODE', modo);
      const r = pedir('/', { 'content-security-policy': "script-src 'nonce-atacante'", 'content-security-policy-report-only': "script-src 'nonce-atacante'" });
      expect(repassado(r, 'content-security-policy') ?? '', modo).not.toContain('atacante');
      expect(repassado(r, 'content-security-policy-report-only'), modo).toBeNull();
    }
  });

  it('API e arquivos não recebem a CSP de documento; off não mexe em nada', () => {
    vi.stubEnv('LN_CSP_MODE', 'enforce');
    for (const p of ['/api/midia/1/arquivo', '/robots.txt']) expect(pedir(p).headers.get('content-security-policy'), p).toBeNull();
    vi.stubEnv('LN_CSP_MODE', 'off');
    const r = pedir('/');
    expect(r.headers.get('content-security-policy')).toBeNull();
    expect(r.headers.get('content-security-policy-report-only')).toBeNull();
  });

  it('o caminho do Studio continua sendo entregue ao guard', () => {
    expect(repassado(pedir('/studio/leads?x=1', { 'x-ln-studio-path': '/forjado' }), 'x-ln-studio-path')).toContain('/studio/leads');
  });
});
