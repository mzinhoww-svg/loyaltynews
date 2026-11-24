#!/usr/bin/env node
// Mede TRUSTED_PROXY_HOPS contra a borda real da Vertra, SEM expor nenhum IP: só contagens e posições.
// Pré-requisito (o PM executa): `set_env DIAG_XFF=1` + `restart_app` no web de STAGING (o diagnóstico é recusado em produção). Depois desta medição:
// `set_env TRUSTED_PROXY_HOPS=<valor>` (se mudar), `delete_env DIAG_XFF`, `restart_app`.
// Uso: node infra/scripts/medir-hops.mjs --url https://host [--atual 3] [--n 5]
// Método (infra/vertra: PEDIDO-PROVISIONAMENTO-v1 §5): GET /api/health com UMA entrada falsa em X-Forwarded-For (203.0.113.9, TEST-NET, não é IP de ninguém);
//   o app devolve x-ln-xff-count (total de entradas que chegaram); hops = contagem − 1 (a entrada falsa não é de proxy). Sem o cabeçalho falso a contagem é a das entradas da borda.
//   Com CF-Connecting-IP (a borda é Cloudflare), x-ln-xff-match-pos = posição, da direita, do IP real do cliente no XFF; coerente com hops quando pos = contagem − 1.
// Saída: uma linha JSON (contagens, posições, veredito). Código 0 = medição estável; 1 = instável ou diferente de --atual; 3 = diagnóstico desligado (sem cabeçalhos x-ln-xff-*).
import { parseArgs } from './lib/util.mjs';
import { pathToFileURL } from 'node:url';

const FALSO = '203.0.113.9';

/** Pura: resume as respostas (só números) e decide o valor. `com` = respostas com XFF falso; `sem` = sem XFF; cada item {count, match, pos} ou null (cabeçalho ausente). */
export function resumir(com, sem, atual) {
  const cabecalhos = [...com, ...sem].some((x) => x && x.count !== null);
  if (!cabecalhos) return { ok: false, motivo: 'diagnostico_desligado', dica: 'defina DIAG_XFF=1 no web de staging e reinicie' };
  const cs = com.map((x) => x?.count).filter((n) => Number.isInteger(n));
  const ss = sem.map((x) => x?.count).filter((n) => Number.isInteger(n));
  const estavel = cs.length > 0 && cs.every((n) => n === cs[0]);
  const hops = estavel ? cs[0] - 1 : null;
  const pos = [...new Set(com.map((x) => x?.pos).filter((p) => p !== null && p !== undefined))];
  const out = { ok: estavel && hops >= 1 && hops <= 10, contagemComFalso: cs, contagemSemFalso: ss, hopsMedido: hops, posicaoDoClienteAPartirDaDireita: pos, atual: atual ?? null };
  if (!estavel) out.motivo = 'contagem_instavel';
  else if (hops < 1 || hops > 10) out.motivo = 'hops_fora_de_1_a_10';
  if (out.ok && atual !== undefined && atual !== null) { out.igualAoAtual = hops === atual; if (hops !== atual) out.ok = false; }
  if (out.ok && pos.length === 1 && pos[0] !== 'none' && Number(pos[0]) !== hops) out.aviso = 'posicao_do_cliente_diferente_de_contagem_menos_1: confira a topologia antes de gravar';
  return out;
}

async function uma(url, xff) {
  const headers = { 'user-agent': 'ln-medir-hops/1', ...(xff ? { 'x-forwarded-for': xff } : {}) };
  const r = await fetch(`${url}/api/health`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  await r.text();
  const c = r.headers.get('x-ln-xff-count');
  return { status: r.status, count: c === null ? null : Number(c), match: r.headers.get('x-ln-xff-match'), pos: r.headers.get('x-ln-xff-match-pos') };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(url)) { console.error('use --url https://host (staging)'); process.exit(2); }
  const n = Math.min(Math.max(Number(args.n ?? 5) || 5, 1), 20);
  const atual = args.atual !== undefined && args.atual !== true ? Number(args.atual) : undefined;
  const com = [], sem = [];
  for (let i = 0; i < n; i++) { com.push(await uma(url, FALSO)); sem.push(await uma(url, null)); }
  const r = resumir(com, sem, atual);
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : r.motivo === 'diagnostico_desligado' ? 3 : 1);
}
