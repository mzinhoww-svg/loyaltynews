#!/usr/bin/env node
// Sonda de saúde para rotina externa (OpenBot) e para o checklist de deploy. Código 0 = saudável, 1 = alertar.
// Contrato dos endpoints (dono: Backend em apps/web/app/api; pedido registrado em infra/docs/observabilidade.md):
//   GET /api/health  -> 200 {"status":"ok","version":"<APP_COMMIT>","env":"staging|production","time":"<ISO>"}  (sem dependências;
//                       é o health_check_path da Vertra: qualquer 5xx reprova o deploy, 404 conta como saudável)
//   GET /api/ready   -> 200 {"status":"ok"|"degraded","checks":{"db":..,"redis":..,"workers":..}}; 503 se algo crítico cair
// Uso: node infra/scripts/healthcheck.mjs --url https://host [--ready] [--expect-commit <sha>] [--timeout 5000] [--retries 2]
import { parseArgs, fail } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.url || args.url === true) fail('use --url https://host', 2);
const base = String(args.url).replace(/\/$/, '');
const path = args.ready ? '/api/ready' : '/api/health';
const timeout = Number(args.timeout ?? 5000);
const retries = Number(args.retries ?? 2);

async function once() {
  const t0 = performance.now();
  const res = await fetch(base + path, { signal: AbortSignal.timeout(timeout), redirect: 'manual', headers: { 'user-agent': 'ln-healthcheck/1' } });
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try { body = await res.json(); } catch { /* corpo não-JSON */ }
  return { status: res.status, ms, body };
}

let last;
for (let i = 0; i <= retries; i++) {
  try {
    last = await once();
    const problems = [];
    if (last.status !== 200) problems.push(`HTTP ${last.status}`);
    if (!last.body || !['ok', 'degraded'].includes(last.body.status)) problems.push('corpo sem status ok/degraded');
    if (!args.ready && last.body && last.body.status !== 'ok') problems.push(`status=${last.body.status}`);
    if (args['expect-commit'] && last.body?.version !== args['expect-commit']) problems.push(`version=${last.body?.version} != ${args['expect-commit']}`);
    if (problems.length === 0) {
      console.log(JSON.stringify({ ok: true, url: base + path, ms: last.ms, status: last.body?.status, version: last.body?.version, checks: last.body?.checks }));
      process.exit(0);
    }
    last.problems = problems;
  } catch (e) {
    last = { error: e.name === 'TimeoutError' ? `timeout ${timeout} ms` : e.message };
  }
  if (i < retries) await new Promise((r) => setTimeout(r, 1500));
}
console.log(JSON.stringify({ ok: false, url: base + path, ...last }));
process.exit(1);
