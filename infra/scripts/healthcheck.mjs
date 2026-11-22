#!/usr/bin/env node
// Sonda de saúde para rotina externa (OpenBot) e para o checklist de deploy. Código 0 = saudável, 1 = alertar.
// Contrato dos endpoints (dono: Backend/Architect; pedido em infra/docs/observabilidade.md):
//   GET /api/health  -> 200 {"status":"ok", ...}; ideal: "version":"<APP_COMMIT>","env":"..." (é o health_check_path da Vertra:
//                       qualquer 5xx reprova o deploy, 404 conta como saudável; por isso é raso, sem dependências)
//   GET /api/ready   -> 200 {"status":"ok"|"degraded","checks":{...}}; 503 se algo crítico cair
// Sondas de SEGURANÇA de runtime (alerta do PM): provam que variáveis só de teste não estão ativas no ambiente implantado.
//   --denied <caminho>   o caminho (ex.: /studio) NÃO pode abrir sem login: exige 301/302/303/307/308/401/403, nunca 200
//   --no-mock <caminho>  o caminho (ex.: / ou /noticias) deve responder 200 e NÃO conter a faixa/texto "MOCK"
// Uso: node infra/scripts/healthcheck.mjs --url https://host [--ready] [--expect-commit <sha>] [--timeout 5000] [--retries 2]
//        [--denied /studio] [--no-mock /]
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
  return { status: res.status, ms, body, location: res.headers.get('location') };
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
if (failures.length) {
  console.log(JSON.stringify({ ...out, ok: false, failures }));
  process.exit(1);
}
console.log(JSON.stringify(out));
