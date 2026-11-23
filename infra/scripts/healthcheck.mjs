#!/usr/bin/env node
// Sonda de saúde para rotina externa (OpenBot) e para o checklist de deploy. Código 0 = saudável, 1 = alertar.
// Contrato dos endpoints (dono: Backend/Architect; pedido em infra/docs/observabilidade.md):
//   GET /api/health  -> 200 {"status":"ok", ...}; ideal: "version":"<APP_COMMIT>","env":"..." (é o health_check_path da Vertra:
//                       qualquer 5xx reprova o deploy, 404 conta como saudável; por isso é raso, sem dependências)
//   GET /api/ready   -> 200 {"status":"ok"|"degraded","checks":{...}}; 503 se algo crítico cair
// Sondas de SEGURANÇA de runtime (alerta do PM): provam que variáveis só de teste não estão ativas no ambiente implantado.
//   --denied <caminho>   o caminho (ex.: /studio) NÃO pode abrir sem login: exige 301/302/303/307/308/401/403, nunca 200
//   --no-mock <caminho>  o caminho (ex.: / ou /noticias) deve responder 200 e NÃO conter a faixa/texto "MOCK"
//   --canonical <url>    o canonical da home (estática) E de /noticias (dinâmica) precisa começar com <url> (sem localhost): prova que NEXT_PUBLIC_SITE_URL existe no build e em execução
//   --noindex <caminho>  staging NÃO pode ser indexado: robots.txt com Disallow: / (e sem Allow: /), sitemap sem URLs e o caminho com
//                        X-Robots-Tag ou meta robots contendo noindex
// Uso: node infra/scripts/healthcheck.mjs --url https://host [--ready] [--expect-commit <sha>] [--timeout 5000] [--retries 2]
//        [--denied /studio] [--no-mock /] [--noindex /]
import { parseArgs, fail } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.url || args.url === true) fail('use --url https://host', 2);
const base = String(args.url).replace(/\/$/, '');
const path = args.ready ? '/api/ready' : '/api/health';
const timeout = Number(args.timeout ?? 5000);
const retries = Number(args.retries ?? 2);
const REDIRECTS = [301, 302, 303, 307, 308];

async function get(p, { json = false } = {}) {
  const t0 = performance.now();
  const res = await fetch(base + p, { signal: AbortSignal.timeout(timeout), redirect: 'manual', headers: { 'user-agent': 'ln-healthcheck/1' } });
  const ms = Math.round(performance.now() - t0);
  let body = null;
  if (json) { try { body = await res.json(); } catch { /* corpo não-JSON */ } } else { body = await res.text(); }
  return { status: res.status, ms, body, location: res.headers.get('location'), xrobots: res.headers.get('x-robots-tag') };
}

let last;
let healthy = false;
for (let i = 0; i <= retries && !healthy; i++) {
  try {
    last = await get(path, { json: true });
    const problems = [];
    if (last.status !== 200) problems.push(`HTTP ${last.status}`);
    if (!last.body || !['ok', 'degraded'].includes(last.body.status)) problems.push('corpo sem status ok/degraded');
    if (!args.ready && last.body && last.body.status !== 'ok') problems.push(`status=${last.body.status}`);
    if (args['expect-commit'] && last.body?.version !== args['expect-commit']) problems.push(`version=${last.body?.version} != ${args['expect-commit']}`);
    if (problems.length === 0) healthy = true; else last.problems = problems;
  } catch (e) {
    last = { error: e.name === 'TimeoutError' ? `timeout ${timeout} ms` : e.message };
  }
  if (!healthy && i < retries) await new Promise((r) => setTimeout(r, 1500));
}
if (!healthy) {
  console.log(JSON.stringify({ ok: false, url: base + path, ...last }));
  process.exit(1);
}

const out = { ok: true, url: base + path, ms: last.ms, status: last.body?.status, version: last.body?.version, checks: last.body?.checks };
const failures = [];
if (args.denied) {
  const p = String(args.denied);
  try {
    const r = await get(p);
    out.denied = { path: p, status: r.status, location: r.location };
    if (!REDIRECTS.includes(r.status) && r.status !== 401 && r.status !== 403) failures.push(`${p} respondeu ${r.status} sem login: deveria negar (redirecionar ao login, 401 ou 403); sessão simulada pode estar ativa`);
  } catch (e) { failures.push(`${p}: ${e.message}`); }
}
if (args['no-mock']) {
  const p = String(args['no-mock']);
  try {
    const r = await get(p);
    out.noMock = { path: p, status: r.status };
    if (r.status !== 200) failures.push(`${p} respondeu ${r.status} (esperado 200)`);
    else if (/\bMOCK\b/.test(r.body ?? '')) failures.push(`${p} contém "MOCK": fixtures ativas em ambiente implantado (PORTAL_SOURCE/PORTAL_MODE=mock só em teste)`);
  } catch (e) { failures.push(`${p}: ${e.message}`); }
}
if (args.canonical) {
  const want = String(args.canonical).replace(/\/$/, '');
  // `/` é estática (pode estar certa só porque foi gravada no build e ainda não revalidou); `/noticias` é dinâmica e lê a variável em EXECUÇÃO.
  out.canonical = { esperado: want, paginas: {} };
  for (const p of ['/', '/noticias']) {
    try {
      const r = await get(p);
      const body = String(r.body ?? '');
      const canon = (body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || body.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1];
      out.canonical.paginas[p] = canon ?? null;
      if (!canon) failures.push(`${p}: sem link canonical`);
      else if (!canon.startsWith(want) || /localhost/i.test(canon)) failures.push(`${p}: canonical "${canon}", esperado ${want} (NEXT_PUBLIC_SITE_URL precisa existir no build E no ambiente de execução)`);
    } catch (e) { failures.push(`canonical ${p}: ${e.message}`); }
  }
}
if (args.noindex) {
  const p = String(args.noindex);
  try {
    const rb = await get('/robots.txt');
    const lines = String(rb.body ?? '').split(/\r?\n/).map((l) => l.trim());
    const star = lines.some((l) => /^user-agent:\s*\*$/i.test(l));
    const disallowAll = lines.some((l) => /^disallow:\s*\/$/i.test(l));
    const allowAll = lines.some((l) => /^allow:\s*\/$/i.test(l));
    if (rb.status !== 200 || !star || !disallowAll || allowAll) failures.push(`robots.txt não bloqueia tudo (HTTP ${rb.status}; precisa de User-agent: * e Disallow: / sem Allow: /): o staging seria indexável`);
    const sm = await get('/sitemap.xml');
    if (sm.status === 200 && /<loc>/i.test(String(sm.body ?? ''))) failures.push('sitemap.xml publica URLs: o staging não pode ter sitemap');
    const pg = await get(p);
    const meta = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(String(pg.body ?? '')) || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/i.test(String(pg.body ?? ''));
    const header = /noindex/i.test(pg.xrobots ?? '');
    out.noindex = { robotsTxt: !(rb.status !== 200 || !star || !disallowAll || allowAll), sitemapVazio: !(sm.status === 200 && /<loc>/i.test(String(sm.body ?? ''))), metaRobots: meta, xRobotsTag: header };
    if (!meta && !header) failures.push(`${p} sem noindex (nem meta robots nem X-Robots-Tag): o staging seria indexável`);
  } catch (e) { failures.push(`noindex: ${e.message}`); }
}
if (failures.length) {
  console.log(JSON.stringify({ ...out, ok: false, failures }));
  process.exit(1);
}
console.log(JSON.stringify(out));
