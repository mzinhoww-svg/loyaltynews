#!/usr/bin/env node
// Mede TRUSTED_PROXY_HOPS contra a borda real da Vertra, SEM expor nenhum IP: só contagens e posições.
// Pré-requisito (o PM executa): `set_env DIAG_XFF=1` + `restart_app` no web de STAGING (o diagnóstico é recusado em produção). Depois desta medição:
// `set_env TRUSTED_PROXY_HOPS=<valor>` (se mudar), `delete_env DIAG_XFF`, `restart_app`.
// Uso: node infra/scripts/medir-hops.mjs --url https://host [--atual 3] [--n 5]
// O app escolhe o IP do cliente como a N-ésima entrada do X-Forwarded-For contada da DIREITA (N = TRUSTED_PROXY_HOPS); com menos de N entradas, não usa IP.
// Três sondas em /api/health (o app devolve x-ln-xff-count, x-ln-xff-match e x-ln-xff-match-pos; nenhum IP):
//   com    = UMA entrada falsa em X-Forwarded-For (203.0.113.9, TEST-NET, não é IP de ninguém);
//   multi  = QUATRO entradas falsas (203.0.113.9–12): prova se o cliente consegue colocar entradas à esquerda;
//   sem    = nenhum X-Forwarded-For: a contagem é a das entradas que a borda escreve sozinha.
// Dois comportamentos possíveis da borda:
//   ANEXA     (contagem com falso > sem falso): o que o cliente escreve fica à esquerda; hops = contagem − 1 (a entrada falsa não é de proxy).
//   REESCREVE (contagem igual com e sem falso): a borda descarta o X-Forwarded-For do cliente; as entradas são só as da borda. O cliente real é a entrada mais à esquerda;
//              hops = posição do cliente a partir da DIREITA (x-ln-xff-match-pos, exige CF-Connecting-IP, ou seja, requisição que passou pelo Cloudflare). Sem a posição: inconclusivo.
// Saída: uma linha JSON (contagens, posições, veredito). Código 0 = medição estável e igual a --atual (ou sem --atual); 1 = instável, inconclusiva ou diferente de --atual; 3 = diagnóstico desligado.
import { parseArgs } from './lib/util.mjs';
import { pathToFileURL } from 'node:url';

const FALSO = '203.0.113.9';
const MULTI = '203.0.113.9, 203.0.113.10, 203.0.113.11, 203.0.113.12';

const unicos = (xs) => [...new Set(xs)];
const nums = (rs) => rs.map((x) => x?.count).filter((n) => Number.isInteger(n));
const poses = (rs) => unicos(rs.map((x) => x?.pos).filter((p) => p !== null && p !== undefined));

/** Pura: resume as respostas (só números) e decide o valor. Cada argumento é uma lista de {count, match, pos}; `multi` é opcional. */
export function resumir(com, sem, atual, multi = []) {
  const todas = [...com, ...sem, ...multi];
  if (!todas.some((x) => x && x.count !== null)) return { ok: false, motivo: 'diagnostico_desligado', dica: 'defina DIAG_XFF=1 no web de staging e reinicie' };
  const cs = nums(com), ss = nums(sem), ms = nums(multi);
  const estavel = cs.length > 0 && cs.every((n) => n === cs[0]) && ss.every((n) => n === ss[0]) && ms.every((n) => n === ms[0]);
  const out = { ok: false, contagemComFalso: cs, contagemSemFalso: ss, contagemComVariosFalsos: ms, posicaoDoClienteAPartirDaDireita: poses(com), match: unicos(com.map((x) => x?.match).filter((m) => m !== null && m !== undefined)), atual: atual ?? null };
  if (!estavel) return { ...out, motivo: 'contagem_instavel' };
  const reescreve = ss.length > 0 && cs[0] === ss[0];
  out.borda = reescreve ? 'reescreve' : 'anexa';
  // O cliente consegue colocar entradas à esquerda? (contagem com vários falsos maior que a sem falso). Com a borda que reescreve, não.
  if (ms.length > 0 && ss.length > 0) out.clienteForjaEntradas = ms[0] !== ss[0];
  let hops = null;
  if (reescreve) {
    const p = out.posicaoDoClienteAPartirDaDireita.filter((x) => x !== 'none');
    if (p.length === 1 && Number.isInteger(Number(p[0]))) { hops = Number(p[0]); out.metodo = 'posicao_do_cliente'; }
    else return { ...out, motivo: 'borda_reescreve_sem_posicao_do_cliente', dica: 'a posição exige CF-Connecting-IP (requisição pelo Cloudflare) e o IP do cliente nas entradas' };
  } else {
    hops = cs[0] - 1; out.metodo = 'contagem_menos_1';
    const p = out.posicaoDoClienteAPartirDaDireita.filter((x) => x !== 'none');
    if (p.length === 1 && Number(p[0]) !== hops) out.aviso = 'posicao_do_cliente_diferente_de_contagem_menos_1: confira a topologia antes de gravar';
  }
  out.hopsMedido = hops;
  if (!(hops >= 1 && hops <= 10)) return { ...out, motivo: 'hops_fora_de_1_a_10' };
  if (reescreve && out.clienteForjaEntradas === true) out.aviso = 'a borda reescreve mas varias entradas falsas aumentaram a contagem: nao confie na posicao';
  out.ok = true;
  if (atual !== undefined && atual !== null) { out.igualAoAtual = hops === atual; if (hops !== atual) out.ok = false; }
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
  const com = [], sem = [], multi = [];
  for (let i = 0; i < n; i++) { com.push(await uma(url, FALSO)); multi.push(await uma(url, MULTI)); sem.push(await uma(url, null)); }
  const r = resumir(com, sem, atual, multi);
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : r.motivo === 'diagnostico_desligado' ? 3 : 1);
}
