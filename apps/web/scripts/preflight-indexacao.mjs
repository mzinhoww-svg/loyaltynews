#!/usr/bin/env node
/**
 * Pré-voo de indexação (achado 1 da auditoria de produção de 25/11).
 *
 * Uso:
 *   node apps/web/scripts/preflight-indexacao.mjs <url-de-producao> [--etapa-a]
 *
 * Etapa A (noindex ainda ligado): exige sitemap com URLs reais e canonical/og no domínio certo, e aceita o noindex.
 * Etapa B (sem a flag): exige também robots aberto e nenhuma página com noindex. A ordem é obrigatória:
 *   1) NEXT_PUBLIC_SITE_URL=https://www.loyaltynews.com.br no build, sitemap com URLs reais e canonical auto-referente;
 *   2) só então PORTAL_INDEXAVEL=1. Nunca o contrário.
 *
 * Sai com código 1 e a lista de incoerências quando o site ainda não está pronto para a etapa pedida.
 */
import { auditarIndexacao } from '../lib/preflight-indexacao.ts';

const etapaA = process.argv.includes('--etapa-a');
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base || base.startsWith('--')) {
  console.error('Uso: node apps/web/scripts/preflight-indexacao.mjs <url-de-producao> [--etapa-a]');
  process.exit(2);
}

const paginasParaConferir = ['/', '/noticias', '/intelligence', '/intelligence/empresas', '/midia-kit', '/editoria/mercado'];

const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'LoyaltyNews-Preflight/1.0' } });
  return { status: r.status, text: await r.text() };
};

const robots = await get(`${base}/robots.txt`);
const sitemap = await get(`${base}/sitemap.xml`);
const paginas = [];
for (const p of paginasParaConferir) {
  const r = await get(`${base}${p}`);
  if (r.status !== 200) console.warn(`aviso: ${p} respondeu ${r.status}`);
  paginas.push({ url: `${base}${p}`, html: r.text });
}

const problemas = auditarIndexacao(base, {
  robots: robots.text,
  sitemap: sitemap.text,
  paginas,
}, { etapaA });

// Nenhuma URL do sitemap pode dar 404 (aceite da etapa A): confere o status de cada uma.
const locs = [...sitemap.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
for (const u of locs) {
  try {
    const r = await fetch(u, { method: 'GET', headers: { 'user-agent': 'LoyaltyNews-Preflight/1.0' } });
    if (r.status !== 200) problemas.push({ regra: 'sitemap', mensagem: `${u}: responde ${r.status} (o sitemap só pode listar URL 200).` });
  } catch {
    problemas.push({ regra: 'sitemap', mensagem: `${u}: não respondeu.` });
  }
}

console.log(`robots.txt: ${robots.status} · sitemap.xml: ${sitemap.status} com ${locs.length} URL(s) · etapa ${etapaA ? 'A (noindex ligado)' : 'B (índice aberto)'}`);

if (!problemas.length) {
  console.log(etapaA
    ? 'OK etapa A: sitemap com URLs 200 e canonical no domínio certo. O noindex ainda está ligado, como deve ficar até a aprovação da etapa B.'
    : 'OK etapa B: sitemap e canonical coerentes e o índice pode ficar aberto (PORTAL_INDEXAVEL=1).');
  process.exit(0);
}

console.error(`\nNÃO indexar ainda — ${problemas.length} incoerência(s). A ordem é sitemap+canonical primeiro, noindex depois:`);
for (const p of problemas) console.error(`  [${p.regra}] ${p.mensagem}`);
process.exit(1);
