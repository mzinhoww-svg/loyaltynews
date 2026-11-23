#!/usr/bin/env node
/**
 * Sonda de fontes de EMPRESAS e BLOGS (RI, sites oficiais, newsrooms) para apoiar o cadastro do Editorial (DP-28/DP-29).
 * Por URL: consulta robots.txt do host (RFC 9309, ver crawl-guards.mjs; não busca se proíbe/ilegível), faz UMA requisição à
 * página SEM seguir redirecionamento, registra status, se há texto estático ou só casca de JavaScript, feeds RSS/Atom
 * DECLARADOS no HTML e sitemaps declarados no robots.txt.
 *
 * Regras (do proprietário e do QA 2):
 *  - Nunca contornar 403/429/CAPTCHA/robots: a sonda NÃO repete, NÃO troca User-Agent, NÃO tenta rotas alternativas.
 *  - Redirecionamento NÃO é seguido: o estado é "redirecionada" e o destino aparece em `redireciona_para`; ele só será
 *    lido se for cadastrado como candidata própria (com o próprio robots.txt).
 *  - Página de desafio/CAPTCHA/bloqueio com HTTP 200 vira "bloqueada_desafio".
 *  - Pausa de 2 s entre URLs. Fontes classe C (Azul, GOL, ABECS, IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk,
 *    oneworld, ABAV) NÃO são sondadas: só com revisão caso a caso.
 *
 * Uso: node scripts/probe-sources.mjs <lista.json>   → grava <lista>.sonda.json
 *      lista.json = { "fontes": [ { "id", "nome", "url", "tipo", "nota"? } ] }  (serve também para a lista de blogs do Editorial)
 * Não conta como verificação de conteúdo nem habilita fonte: habilitar é o fluxo humano do Studio (Editorial).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { robotsAllows as defaultRobots, fetchText as defaultFetch, UA } from './verify-dataset.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const CLASSE_C = /(voeazul|voegol|abecs|iata\.org|nubank|accor|marriott|salesforce|hubspot|zendesk|oneworld|abav)/i;

/**
 * Sonda UMA fonte. `deps` é injetável para teste (respostas simuladas): { robotsAllows(url), fetchText(url), sleep(ms) }.
 */
export async function sonda(src, deps = {}) {
  const robotsAllows = deps.robotsAllows ?? defaultRobots;
  const fetchText = deps.fetchText ?? defaultFetch;
  const wait = deps.sleep ?? sleep;
  const out = { id: src.id, nome: src.nome, url: src.url, tipo: src.tipo, nota_candidato: src.nota ?? null, robots: null, sitemaps: [], http_status: null, final_url: null, redireciona_para: null, content_type: null, texto_caracteres: 0, renderizacao: null, titulo: null, feeds_declarados: [], estado: null, observacao: '' };
  if (CLASSE_C.test(src.url)) { out.estado = 'nao_sondada_classe_c'; out.observacao = 'classe C (DP-28): só com revisão caso a caso registrada'; return out; }
  const rb = await robotsAllows(src.url);
  out.robots = rb.note;
  out.sitemaps = rb.sitemaps ?? [];
  if (!rb.allowed) {
    // distinguir: robots.txt que PROÍBE x robots.txt que não pôde ser lido (rede/DNS/TLS/HTTP de erro; URL candidata pode estar errada)
    const proibe = rb.note.startsWith('robots.txt proibe');
    out.estado = proibe ? 'bloqueada_por_robots' : 'robots_inacessivel_nao_buscada';
    out.observacao = proibe ? 'robots.txt proíbe: não buscada, não contornar' : 'robots.txt não pôde ser lido (rede, DNS, TLS ou HTTP de erro): por precaução não buscada; confirmar o host real da fonte';
    return out;
  }
  await wait(1000);
  try {
    const f = await fetchText(src.url);
    out.http_status = f.status;
    out.final_url = f.finalUrl;
    out.content_type = (f.contentType ?? '').split(';')[0];
    out.texto_caracteres = f.text.length;
    if (f.estado === 'redirecionada') {
      out.estado = 'redirecionada';
      out.redireciona_para = f.location ?? null;
      out.observacao = f.observacao;
      return out;
    }
    if (f.estado !== 'ok') { out.estado = f.estado; out.observacao = f.observacao; return out; }
    out.titulo = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(f.html)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null;
    out.feeds_declarados = [...f.html.matchAll(/<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)]
      .map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
      .filter(Boolean)
      .map((h) => new URL(h, f.finalUrl).href)
      .slice(0, 5);
    out.renderizacao = f.text.length >= 1500 ? 'estatica' : f.text.length >= 300 ? 'parcial_ou_casca' : 'js_provavel';
    out.estado = out.renderizacao === 'js_provavel' ? 'acessivel_requer_navegador' : 'acessivel';
  } catch (e) {
    out.estado = 'erro_de_rede';
    out.observacao = `${e.name}`;
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const path = process.argv[2];
  if (!path) {
    console.error('uso: node scripts/probe-sources.mjs <lista.json>');
    process.exit(2);
  }
  const cand = JSON.parse(readFileSync(path, 'utf8'));
  const rows = [];
  for (const s of cand.fontes) {
    rows.push(await sonda(s));
    const r = rows.at(-1);
    console.log(`${r.estado.padEnd(30)} ${s.id}  ${s.url}${r.redireciona_para ? `  -> ${r.redireciona_para}` : ''}`);
    await sleep(2000);
  }
  const resumo = {};
  for (const r of rows) resumo[r.estado] = (resumo[r.estado] ?? 0) + 1;
  writeFileSync(path.replace(/\.json$/, '.sonda.json'), JSON.stringify({ gerado_em: new Date().toISOString(), verificador: UA, regra: 'não contornar 403/429/CAPTCHA/robots; 1 requisição por URL; redirecionamento não é seguido', resumo, fontes: rows }, null, 2) + '\n');
  console.log(JSON.stringify(resumo));
}
