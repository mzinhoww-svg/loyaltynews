#!/usr/bin/env node
/**
 * Sonda de fontes de EMPRESAS (RI e sites oficiais) para apoiar o cadastro do Editorial (DP-28/DP-29).
 * Por URL: consulta robots.txt (respeita; não busca se proibido), faz UMA requisição à página, registra status,
 * se há texto estático ou só casca de JavaScript, feeds RSS/Atom DECLARADOS no HTML e sitemaps declarados no robots.txt.
 *
 * Regras (do proprietário): nunca contornar 403/429/CAPTCHA/robots — esta sonda NÃO repete, NÃO troca User-Agent, NÃO tenta
 * rotas alternativas quando bloqueada; só registra "bloqueado". Pausa de 2 s entre URLs. Fontes classe C (Azul, GOL, ABECS,
 * IATA, Nubank, Accor, Marriott, Salesforce, HubSpot, Zendesk, oneworld, ABAV) NÃO entram na lista: só com revisão caso a caso.
 *
 * Uso: node scripts/probe-sources.mjs data/fontes-empresas.candidatos.json   → grava <arquivo>.sonda.json
 * Não conta como verificação de conteúdo nem habilita fonte: habilitar é o fluxo humano do Studio (Editorial).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { robotsAllows, fetchText, UA } from './verify-dataset.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLOCK_WORDS = /(captcha|access denied|acesso negado|attention required|cf-chl|are you a robot|verifique que voc[eê] [eé] humano|unusual traffic)/i;
const CLASSE_C = /(voeazul|voegol|abecs|iata\.org|nubank|accor|marriott|salesforce|hubspot|zendesk|oneworld|abav)/i;

async function sonda(src) {
  const out = { id: src.id, nome: src.nome, url: src.url, tipo: src.tipo, nota_candidato: src.nota ?? null, robots: null, sitemaps: [], http_status: null, final_url: null, content_type: null, texto_caracteres: 0, renderizacao: null, titulo: null, feeds_declarados: [], estado: null, observacao: '' };
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
  await sleep(1000);
  try {
    const f = await fetchText(src.url);
    out.http_status = f.status;
    out.final_url = f.finalUrl;
    out.content_type = f.contentType.split(';')[0];
    out.texto_caracteres = f.text.length;
    if (f.status === 403 || f.status === 429) { out.estado = 'bloqueada_http'; out.observacao = `HTTP ${f.status}: não repetir nem contornar`; return out; }
    if (f.status !== 200) { out.estado = 'indisponivel'; out.observacao = `HTTP ${f.status}`; return out; }
    if (BLOCK_WORDS.test(f.text.slice(0, 3000)) && f.text.length < 1500) { out.estado = 'bloqueada_captcha'; out.observacao = 'página de verificação/bloqueio: não contornar'; return out; }
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

const path = process.argv[2];
if (!path) {
  console.error('uso: node scripts/probe-sources.mjs <candidatos.json>');
  process.exit(2);
}
const cand = JSON.parse(readFileSync(path, 'utf8'));
const rows = [];
for (const s of cand.fontes) {
  rows.push(await sonda(s));
  console.log(`${rows.at(-1).estado.padEnd(28)} ${s.id}  ${s.url}`);
  await sleep(2000);
}
const resumo = {};
for (const r of rows) resumo[r.estado] = (resumo[r.estado] ?? 0) + 1;
writeFileSync(path.replace(/\.json$/, '.sonda.json'), JSON.stringify({ gerado_em: new Date().toISOString(), verificador: UA, regra: 'não contornar 403/429/CAPTCHA/robots; 1 requisição por URL', resumo, fontes: rows }, null, 2) + '\n');
console.log(JSON.stringify(resumo));
