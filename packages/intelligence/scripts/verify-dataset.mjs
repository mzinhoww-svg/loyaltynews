#!/usr/bin/env node
/**
 * Verificador de conjunto de dados do Intelligence (intelligence-seed/1).
 * Para cada FONTE do conjunto: respeita robots.txt, busca a página pública (1 requisição por URL, sem seguir links),
 * calcula sha256 do texto e confere, para cada REGISTRO, se a citação literal (`quote`) aparece no texto da página.
 * Grava `<dataset>.verification.json`. Nada é carregado no banco por este script.
 *
 * Uso:  node scripts/verify-dataset.mjs data/seed.public.v1.json
 *       node scripts/verify-dataset.mjs --robots <url> [<url>…]    (só consulta robots.txt de cada host e diz se o caminho é permitido)
 *       node scripts/verify-dataset.mjs --probe <url> <palavra>     (mostra trechos da página que contêm a palavra; não grava nada)
 *
 * Regras: só HTTP(S) público; sem login, sem cookies; User-Agent identificado; pausa entre requisições; falha vira
 * "unverified" (nunca é aprovada por omissão).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyResponse, detectChallenge, parseRobots, robotsDecision } from './crawl-guards.mjs';

export const UA = 'LoyaltyNewsSourceVerifier/1.0 (verificacao pontual de fonte publica; sem coleta em massa)';
const PAUSE_MS = 1500;
const TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}
/** Entidades HTML nomeadas comuns em português (texto de capturas por provedor pode vir sem decodificar). */
const NAMED = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
for (const [base, accents] of Object.entries({ a: 'acute:á grave:à circ:â tilde:ã uml:ä', e: 'acute:é grave:è circ:ê uml:ë', i: 'acute:í grave:ì circ:î uml:ï', o: 'acute:ó grave:ò circ:ô tilde:õ uml:ö', u: 'acute:ú grave:ù circ:û uml:ü' })) {
  for (const pair of accents.split(' ')) { const [k, ch] = pair.split(':'); NAMED[base + k] = ch; NAMED[base.toUpperCase() + k] = ch.toUpperCase(); }
}
Object.assign(NAMED, { ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ' });
export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, k) => NAMED[k] ?? m);
}
/** Cargo: a citação (nome + cargo literais) pode ser curta (ex.: "Eros Canedo CFO"); o mínimo da relação/organização (20) continua valendo para elas. Mesmo valor do validador (seed-load). */
const MIN_ROLE_QUOTE = 12;
const norm = (s) => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Consulta o robots.txt do HOST da URL (RFC 9309, ver crawl-guards.mjs) e decide para o CAMINHO da URL.
 * robots.txt ausente (404/410) = permitido; qualquer outro erro/status = não busca (precaução). `fetchImpl` injetável para teste.
 */
export async function robotsAllows(url, fetchImpl = fetch) {
  const u = new URL(url);
  try {
    // robots.txt pode redirecionar (RFC 9309 manda seguir até 5): é o arquivo que o próprio host publica.
    const r = await fetchImpl(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 404 || r.status === 410) return { allowed: true, note: 'robots.txt ausente', sitemaps: [] };
    if (!r.ok) return { allowed: false, note: `robots.txt indisponivel (HTTP ${r.status}); por precaucao nao busca`, sitemaps: [] };
    const body = await r.text();
    // robots.txt que responde 200 com PÁGINA DE DESAFIO/BLOQUEIO não é "sem regras": é inacessível e a página NÃO é buscada.
    const headers = Object.fromEntries(r.headers.entries());
    const looksHtml = /html/i.test(r.headers.get('content-type') ?? '') || /^\s*<(?:!doctype|html|head|body|script|meta|title)/i.test(body);
    const challenge = detectChallenge({ status: r.status, headers, html: looksHtml ? body : '', text: looksHtml ? htmlToText(body) : '' });
    if (challenge) return { allowed: false, note: `robots.txt inacessivel (resposta de desafio/bloqueio com HTTP ${r.status}: ${challenge}); por precaucao nao busca`, sitemaps: [] };
    const parsed = parseRobots(body);
    const sitemaps = parsed.sitemaps.slice(0, 5);
    const d = robotsDecision(parsed, UA, u.pathname + u.search);
    if (!d.allowed) return { allowed: false, note: `robots.txt proibe (${d.rule})`, sitemaps };
    return { allowed: true, note: 'robots.txt permite', sitemaps };
  } catch (e) {
    return { allowed: false, note: `robots.txt inacessivel (${e.name}); por precaucao nao busca`, sitemaps: [] };
  }
}

/**
 * UMA requisição à URL, SEM seguir redirecionamento: 3xx volta com `location` (URL absoluta do destino), que deve virar
 * outra candidata com o próprio robots.txt. Devolve também cabeçalhos e a classificação (ok, redirecionada, bloqueada_http,
 * bloqueada_desafio, indisponivel). `fetchImpl` injetável para teste.
 */
export async function fetchText(url, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const ct = r.headers.get('content-type') ?? '';
  const headers = Object.fromEntries(r.headers.entries());
  const loc = r.headers.get('location');
  const body = r.status >= 300 && r.status < 400 ? '' : await r.text();
  const textual = /html|xml|text/i.test(ct);
  const html = textual ? body : '';
  const text = textual ? htmlToText(body) : '';
  const location = loc ? new URL(loc, url).href : null;
  return { status: r.status, finalUrl: url, location, contentType: ct, headers, html, text, ...classifyResponse({ status: r.status, headers, html, text }) };
}


async function probe(url, word) {
  const rb = await robotsAllows(url);
  console.log(`robots: ${rb.note}`);
  if (!rb.allowed) return;
  const f = await fetchText(url);
  console.log(`HTTP ${f.status} ${f.contentType} ${f.finalUrl} texto=${f.text.length} caracteres`);
  if (f.estado !== 'ok') { console.log(`  ${f.estado}: ${f.observacao}${f.location ? ` -> ${f.location}` : ''}`); return; }
  const re = new RegExp(word, 'gi');
  let m;
  let n = 0;
  while ((m = re.exec(f.text)) && n < 6) {
    console.log(`  …${f.text.slice(Math.max(0, m.index - 140), m.index + 220)}…`);
    n++;
  }
  if (n === 0) console.log('  (palavra não encontrada no texto; a página pode depender de JavaScript)');
}

async function verify(path) {
  const ds = JSON.parse(readFileSync(path, 'utf8'));
  if (ds.schemaVersion !== 'intelligence-seed/1' && ds.schemaVersion !== 'intelligence-seed/2') throw new Error('schemaVersion deve ser intelligence-seed/1 ou intelligence-seed/2');
  const out = { datasetId: ds.datasetId, verifiedAt: new Date().toISOString(), verifier: UA, sources: [], records: [] };
  const texts = new Map();
  for (const s of ds.sources) {
    if (s.method === 'browser' || s.method === 'capture') {
      // Página que só renderiza com JavaScript: texto capturado pelo navegador do OpenBot (data/captures/<id>.json).
      // O verificador NÃO acessa a rede aqui: recalcula o sha256 do texto e compara com o calculado dentro do navegador.
      const e = { id: s.id, url: s.url, method: 'openbot_browser', status: 'unverified', http_status: null, fetched_at: null, content_sha256: null, text_length: 0, robots: null, note: '' };
      out.sources.push(e);
      try {
        const cap = JSON.parse(readFileSync(join(dirname(path), 'captures', `${s.id}.json`), 'utf8'));
        const sha = sha256(cap.text);
        if (cap.url !== s.url) e.note = 'URL da captura difere da fonte';
        else if (sha !== cap.sha256Claimed) e.note = 'sha256 do texto difere do calculado no navegador (texto alterado ou transcrito errado)';
        else if (cap.text.length < 200) e.note = 'texto da captura muito curto';
        else {
          Object.assign(e, { status: 'fetched', http_status: 200, fetched_at: cap.capturedAt, content_sha256: sha, text_length: cap.text.length, robots: cap.robots, final_url: cap.finalUrl });
          // a captura guarda o texto como veio (pode trazer entidades HTML, ex.: &ocirc;); a comparação usa o texto decodificado
          texts.set(s.id, norm(decodeEntities(cap.text)));
        }
      } catch (err) {
        e.note = `captura ilegível: ${err.message}`.slice(0, 200);
      }
      continue;
    }
    const entry = { id: s.id, url: s.url, method: 'http', status: 'unverified', http_status: null, fetched_at: null, content_sha256: null, text_length: 0, robots: null, note: '' };
    out.sources.push(entry);
    try {
      if (!/^https:\/\//i.test(s.url)) { entry.note = 'apenas https'; continue; }
      const rb = await robotsAllows(s.url);
      entry.robots = rb.note;
      if (!rb.allowed) { entry.note = rb.note; continue; }
      await sleep(PAUSE_MS);
      const f = await fetchText(s.url);
      entry.http_status = f.status;
      entry.fetched_at = new Date().toISOString();
      // redirecionamento não é seguido (o destino é OUTRA fonte, com robots próprio); desafio/bloqueio nunca é contornado
      if (f.estado === 'redirecionada') { entry.note = `${f.observacao} -> ${f.location ?? '(sem Location)'}; cadastre o destino como fonte própria`; continue; }
      if (f.estado !== 'ok') { entry.note = f.observacao; continue; }
      entry.final_url = f.finalUrl;
      entry.text_length = f.text.length;
      entry.content_sha256 = sha256(f.text);
      if (f.text.length < 200) { entry.note = 'texto vazio ou muito curto (página dependente de JavaScript?)'; continue; }
      entry.status = 'fetched';
      texts.set(s.id, norm(f.text));
    } catch (e) {
      entry.note = `${e.name}: ${e.message}`.slice(0, 200);
    }
    await sleep(PAUSE_MS);
  }
  const all = [
    ...ds.organizations.map((o) => ({ ref: `organization:${o.key}`, sourceId: o.sourceId, quote: o.quote, contextQuote: o.contextQuote })),
    ...ds.relations.map((r) => ({ ref: `relation:${r.from}>${r.type}>${r.to}`, sourceId: r.sourceId, quote: r.quote, contextQuote: r.contextQuote })),
    ...(ds.persons ?? []).map((p) => ({ ref: `person:${p.key}`, sourceId: p.sourceId, quote: p.quote })),
    // cargos públicos (intelligence-seed/2): a citação (nome + cargo) precisa estar literalmente na página; a mesma referência que o carregador monta (roleRef)
    ...(ds.roles ?? []).map((r) => ({ ref: `role:${r.orgKey}>${r.personName}>${r.title}`, sourceId: r.sourceId, quote: r.quote, minLen: MIN_ROLE_QUOTE })),
    // achados sobre termos de uso/direitos (revisão J-14): também exigem citação literal na página indicada
    ...(ds.termsFindings ?? []).map((f) => ({ ref: `terms:${f.id}`, sourceId: f.sourceId, quote: f.quote })),
  ];
  for (const rec of all) {
    const t = texts.get(rec.sourceId);
    const has = (q, min = 20) => t !== undefined && typeof q === 'string' && q.length >= min && t.includes(norm(q));
    // contextQuote (opcional) também precisa estar literalmente na página: é o que dá sentido à lista (ex.: título "Empresas Associadas")
    const found = has(rec.quote, rec.minLen) && (rec.contextQuote === undefined || has(rec.contextQuote));
    out.records.push({ ref: rec.ref, source_id: rec.sourceId, quote_found: found });
  }
  for (const s of out.sources) if (s.status === 'fetched') s.status = out.records.filter((r) => r.source_id === s.id).every((r) => r.quote_found) ? 'verified' : 'partial';
  const dest = path.replace(/\.json$/, '.verification.json');
  writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  const ok = out.records.filter((r) => r.quote_found).length;
  console.log(`${ok}/${out.records.length} registros com citação literal encontrada. Relatório: ${dest}`);
  for (const r of out.records) console.log(`  ${r.quote_found ? 'OK  ' : 'FALHA'} ${r.ref}`);
  for (const s of out.sources) if (s.status === 'unverified') console.log(`  fonte ${s.id} não verificada: ${s.note}`);
}

// Só executa quando chamado direto (scripts/probe-sources.mjs importa as funções acima sem disparar nada).
// Só executa quando o PRÓPRIO arquivo é o ponto de entrada (num bundle do esbuild import.meta.url é o do bundle; o nome do arquivo evita falso positivo).
const isMain = Boolean(process.argv[1]) && /verify-dataset\.mjs$/.test(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
const [a, b, c] = isMain ? process.argv.slice(2) : [];
if (!isMain) {
  /* importado como módulo */
} else if (a === '--robots') {
  for (const u of process.argv.slice(3)) {
    const r = await robotsAllows(u);
    console.log(`${r.allowed ? 'PERMITIDO' : 'BLOQUEADO'}  ${u}  (${r.note})`);
    await sleep(500);
  }
} else if (a === '--probe') await probe(b, c);
else if (a) await verify(a);
else console.log('uso: node scripts/verify-dataset.mjs <dataset.json> | --probe <url> <palavra>');
