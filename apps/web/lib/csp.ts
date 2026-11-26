/**
 * Content-Security-Policy dos DOCUMENTOS (portal e Studio), com nonce por requisição. Aplicada pelo proxy.ts em tempo de execução.
 *
 * `LN_CSP_MODE` (variável de EXECUÇÃO):
 *  - `report` (padrão, também para valor desconhecido): a política com nonce vai em `Content-Security-Policy-Report-Only`; nada é
 *    bloqueado e as violações chegam em CSP_REPORT_PATH. A CSP aplicada continua a estática do next.config.ts.
 *  - `enforce`: a mesma política vai em `Content-Security-Policy` (bloqueia) e segue relatando.
 *  - `off`: o proxy não mexe em CSP; valem só os cabeçalhos estáticos do next.config.ts (saída de emergência, sem novo build).
 *
 * `script-src` com nonce + `'strict-dynamic'`: só rodam os scripts que o servidor marcou (o Next marca os de hidratação ao ler o
 * nonce no cabeçalho da REQUISIÇÃO) e os que eles criam (gtag do GA4, depois do consentimento). Navegador sem `'strict-dynamic'`
 * cai em 'self' + googletagmanager. `style-src` mantém 'unsafe-inline': o portal usa estilo inline em muitos componentes.
 * JSON-LD (`type="application/ld+json"`) é dado, não script.
 */
export type ModoCsp = 'off' | 'report' | 'enforce';

export const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_REPORT_GROUP = 'csp';

export function modoCsp(valor: string | undefined): ModoCsp {
  const v = String(valor ?? '').trim().toLowerCase();
  return v === 'off' || v === 'enforce' ? v : 'report';
}

/** Documento = o que o navegador renderiza como página. API (que tem CSP própria na mídia), estáticos e arquivos ficam de fora. */
export function ehDocumento(pathname: string): boolean {
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(pathname);
}

/** 128 bits aleatórios em base64. */
export function gerarNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function politicaCsp(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' só no `next dev` (React usa eval para depurar); nunca no build de produção.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.googletagmanager.com${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com${dev ? ' ws:' : ''}`,
    "media-src 'self' https:",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join('; ');
}
