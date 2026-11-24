#!/usr/bin/env node
// Prova de caixa-preta dos CABEÇALHOS DE SEGURANÇA do portal (só leitura; HEAD/GET sem credencial). Achado P2-6 da auditoria de design (24/11/2026).
// Roda em `next start` local do build de produção, no staging e na produção. Confere em TODAS as rotas testadas (inclusive 404, API, robots e um arquivo estático):
//   X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin; X-Frame-Options SAMEORIGIN; Permissions-Policy negando câmera, microfone, geolocalização,
//   pagamento e USB; CSP APLICADA com frame-ancestors/base-uri/object-src (sem 'unsafe-eval'); CSP em modo relatório com default-src 'self'; HSTS por ambiente
//   (staging max-age=86400, production max-age=31536000, sem includeSubDomains nem preload).
// Uso: node infra/scripts/verificar-seguranca-headers.mjs --url https://host [--ambiente staging|production] [--com-cache]
//   --com-cache  também roda verificar-cache-headers.mjs: a política de cache (60 s / no-store) tem de continuar intacta COM os cabeçalhos de segurança no ar.
// Saída: uma linha JSON por rota + resumo. Código 0 = tudo conforme; 1 = alguma violação; 2 = uso errado.
import { parseArgs } from './lib/util.mjs';
import { verificar as verificarCache } from './verificar-cache-headers.mjs';
import { pathToFileURL } from 'node:url';

export const HSTS = { staging: 'max-age=86400', production: 'max-age=31536000' };
export const ROTAS = ['/', '/noticias', '/noticia/materia-que-nao-existe-ensaio', '/studio/entrar', '/api/health', '/robots.txt', '/sitemap.xml'];

/** Pura: problemas dos cabeçalhos de UMA resposta (`h` = objeto com nomes em minúsculas). */
export function avaliarSeguranca(h, ambiente) {
  const p = [];
  const v = (k) => String(h[k] ?? '');
  if (v('x-content-type-options').toLowerCase() !== 'nosniff') p.push(`x-content-type-options: esperado nosniff, veio "${v('x-content-type-options') || '(ausente)'}"`);
  if (v('referrer-policy').toLowerCase() !== 'strict-origin-when-cross-origin') p.push(`referrer-policy: esperado strict-origin-when-cross-origin, veio "${v('referrer-policy') || '(ausente)'}"`);
  if (v('x-frame-options').toUpperCase() !== 'SAMEORIGIN') p.push(`x-frame-options: esperado SAMEORIGIN, veio "${v('x-frame-options') || '(ausente)'}"`);
  const pp = v('permissions-policy');
  for (const d of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']) if (!pp.includes(d)) p.push(`permissions-policy sem ${d}`);
  const csp = v('content-security-policy');
  for (const d of ["frame-ancestors 'self'", "base-uri 'self'", "object-src 'none'"]) if (!csp.includes(d)) p.push(`content-security-policy sem ${d}`);
  if (csp.includes("'unsafe-eval'")) p.push("content-security-policy com 'unsafe-eval'");
  if (!v('content-security-policy-report-only').includes("default-src 'self'")) p.push("content-security-policy-report-only sem default-src 'self'");
  const hsts = v('strict-transport-security');
  if (!hsts) p.push('strict-transport-security ausente');
  else {
    if (hsts !== HSTS[ambiente]) p.push(`strict-transport-security: esperado "${HSTS[ambiente]}" (${ambiente}), veio "${hsts}"`);
    if (/includeSubDomains|preload/i.test(hsts)) p.push('strict-transport-security não pode ter includeSubDomains nem preload (o host é *.vertraweb.app)');
  }
  return p;
}

export async function verificarSeguranca({ url, ambiente = 'staging', timeout = 20000 }) {
  const base = url.replace(/\/+$/, '');
  const resultados = [];
  const sondar = async (rota, extra = {}) => {
    try {
      const r = await fetch(base + rota, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'ln-seguranca-check/1' }, ...extra });
      const h = Object.fromEntries([...r.headers.entries()]);
      const corpo = extra.method === 'HEAD' ? '' : await r.text();
      const problemas = avaliarSeguranca(h, ambiente);
      resultados.push({ rota, status: r.status, ok: problemas.length === 0, ...(problemas.length ? { problemas } : {}) });
      return corpo;
    } catch (e) { resultados.push({ rota, ok: false, problemas: [`a sonda falhou (${e?.name ?? 'Erro'})`] }); return ''; }
  };
  let home = '';
  for (const rota of ROTAS) { const c = await sondar(rota); if (rota === '/') home = c; }
  // um arquivo estático do build (CSS/JS com hash) da própria home
  const estatico = (home.match(/(?:href|src)="(\/_next\/static\/[^"?]+)"/) || [])[1];
  if (estatico) await sondar(estatico); else resultados.push({ rota: '/_next/static/…', ok: false, problemas: ['a home não referencia nenhum arquivo em /_next/static (build sem estáticos?)'] });
  return { url: base, ambiente, total: resultados.length, violacoes: resultados.filter((x) => !x.ok).length, resultados };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url ?? '');
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1[:/]/.test(url)) { console.error('use --url https://host'); process.exit(2); }
  const ambiente = args.ambiente && args.ambiente !== true ? String(args.ambiente) : 'staging';
  if (!HSTS[ambiente]) { console.error('--ambiente deve ser staging ou production'); process.exit(2); }
  const r = await verificarSeguranca({ url, ambiente });
  for (const x of r.resultados) console.log(JSON.stringify(x));
  let violacoes = r.violacoes;
  if (args['com-cache']) {
    const c = await verificarCache({ url, valores: { editoria: 'mercado' } });
    console.log(JSON.stringify({ cache: true, total: c.total, violacoes: c.violacoes }));
    violacoes += c.violacoes;
  }
  console.log(JSON.stringify({ resumo: true, total: r.total, violacoes }));
  process.exit(violacoes ? 1 : 0);
}
