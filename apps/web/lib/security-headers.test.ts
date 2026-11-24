import { describe, expect, it } from 'vitest';
import config, { CSP_APLICADA, CSP_RELATORIO, PERMISSIONS_POLICY, hstsDe, portalCacheHeaders, portalSecurityHeaders } from '../next.config';

const valor = (regras: ReturnType<typeof portalSecurityHeaders>, chave: string) =>
  regras[0]!.headers.find((h) => h.key.toLowerCase() === chave.toLowerCase())?.value;

describe('cabeçalhos de segurança do portal (achado P2-6, 24/11/2026)', () => {
  it('uma regra para todas as rotas com o conjunto mínimo (staging)', () => {
    const r = portalSecurityHeaders('staging');
    expect(r).toHaveLength(1);
    expect(r[0]!.source).toBe('/:path*');
    expect(valor(r, 'X-Content-Type-Options')).toBe('nosniff');
    expect(valor(r, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(valor(r, 'X-Frame-Options')).toBe('SAMEORIGIN');
    expect(valor(r, 'Permissions-Policy')).toBe(PERMISSIONS_POLICY);
    expect(valor(r, 'Content-Security-Policy')).toBe(CSP_APLICADA);
    expect(valor(r, 'Content-Security-Policy-Report-Only')).toBe(CSP_RELATORIO);
    expect(valor(r, 'Strict-Transport-Security')).toBe('max-age=86400');
  });

  it('HSTS: 1 dia no staging, 1 ano em produção, sem includeSubDomains nem preload (o host é *.vertraweb.app); ausente em dev/teste/sem APP_ENV', () => {
    expect(hstsDe('production')).toBe('max-age=31536000');
    expect(hstsDe('staging')).toBe('max-age=86400');
    for (const a of ['production', 'staging']) expect(hstsDe(a)).not.toMatch(/includeSubDomains|preload/i);
    for (const a of [undefined, '', 'development', 'test', 'homologacao']) expect(hstsDe(a), String(a)).toBeNull();
    expect(valor(portalSecurityHeaders('production'), 'Strict-Transport-Security')).toBe('max-age=31536000');
    expect(valor(portalSecurityHeaders(undefined), 'Strict-Transport-Security')).toBeUndefined();
  });

  it('a CSP APLICADA só tem diretivas que não carregam recurso (não quebra página); a completa vai em modo relatório', () => {
    expect(CSP_APLICADA).toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
    for (const d of ['default-src', 'script-src', 'style-src', 'img-src', 'connect-src', 'form-action']) expect(CSP_APLICADA).not.toContain(d);
    for (const d of ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'"]) expect(CSP_RELATORIO).toContain(d);
    // nada de curinga aberto em script/default: só 'self' (+ 'unsafe-inline' no script por causa da hidratação do Next e do cache de borda)
    expect(CSP_RELATORIO).not.toMatch(/(default|script)-src[^;]*(\*|https:)/);
    expect(CSP_RELATORIO).not.toContain("'unsafe-eval'");
  });

  it('não há chave em comum com a política de cache: nenhuma regra de segurança sobrescreve (nem é sobrescrita por) Cache-Control', () => {
    const seg = new Set(portalSecurityHeaders('production')[0]!.headers.map((h) => h.key.toLowerCase()));
    expect(seg.has('cache-control')).toBe(false);
    for (const regra of portalCacheHeaders()) for (const h of regra.headers) expect(seg.has(h.key.toLowerCase()), h.key).toBe(false);
  });

  it('o headers() do next.config.ts entrega a regra de segurança primeiro e as de cache intactas, e nunca um valor com quebra de linha', async () => {
    const todas = await config('phase-production-server').headers!();
    expect(todas[0]!.source).toBe('/:path*');
    expect(todas.slice(1)).toEqual(portalCacheHeaders());
    for (const r of todas) for (const h of r.headers) expect(`${h.key}${h.value}`).not.toMatch(/[\r\n]/);
  });
});
