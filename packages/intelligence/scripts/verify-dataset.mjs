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

const UA = 'LoyaltyNewsSourceVerifier/1.0 (verificacao pontual de fonte publica; sem coleta em massa)';
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
const norm = (s) => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

async function robotsAllows(url) {
  const u = new URL(url);
  try {
    const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 404 || r.status === 410) return { allowed: true, note: 'robots.txt ausente' };
    if (!r.ok) return { allowed: false, note: `robots.txt indisponivel (HTTP ${r.status}); por precaucao nao busca` };
    const lines = (await r.text()).split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
    let applies = false;
    let sawGroup = false;
    const disallow = [];
    const allow = [];
    for (const l of lines) {
      const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(l);
      if (!m) continue;
      const k = m[1].toLowerCase();
      const v = m[2].trim();
      if (k === 'user-agent') {
        if (sawGroup && !applies) { /* novo grupo */ }
        applies = v === '*' || UA.toLowerCase().includes(v.toLowerCase());
        sawGroup = true;
      } else if (applies && k === 'disallow' && v) disallow.push(v);
      else if (applies && k === 'allow' && v) allow.push(v);
    }
    const path = u.pathname + u.search;
    const longest = (arr) => arr.filter((p) => path.startsWith(p.replace(/\*$/, ''))).sort((a, b) => b.length - a.length)[0];
    const d = longest(disallow);
    const a = longest(allow);
    if (d && (!a || a.length < d.length)) return { allowed: false, note: `robots.txt proibe ${d}` };
    return { allowed: true, note: 'robots.txt permite' };
  } catch (e) {
    return { allowed: false, note: `robots.txt inacessivel (${e.name}); por precaucao nao busca` };
  }
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const ct = r.headers.get('content-type') ?? '';
  const body = await r.text();
  return { status: r.status, finalUrl: r.url, contentType: ct, text: /html|xml|text/i.test(ct) ? htmlToText(body) : '' };
}

async function probe(url, word) {
  const rb = await robotsAllows(url);
  console.log(`robots: ${rb.note}`);
  if (!rb.allowed) return;
  const f = await fetchText(url);
  console.log(`HTTP ${f.status} ${f.contentType} ${f.finalUrl} texto=${f.text.length} caracteres`);
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
  if (ds.schemaVersion !== 'intelligence-seed/1') throw new Error('schemaVersion deve ser intelligence-seed/1');
  const out = { datasetId: ds.datasetId, verifiedAt: new Date().toISOString(), verifier: UA, sources: [], records: [] };
  const texts = new Map();
  for (const s of ds.sources) {
    if (s.method === 'browser') {
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
          texts.set(s.id, norm(cap.text));
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
      if (f.status !== 200) { entry.note = `HTTP ${f.status}`; continue; }
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
  ];
  for (const rec of all) {
    const t = texts.get(rec.sourceId);
    const has = (q) => t !== undefined && typeof q === 'string' && q.length >= 20 && t.includes(norm(q));
    // contextQuote (opcional) também precisa estar literalmente na página: é o que dá sentido à lista (ex.: título "Empresas Associadas")
    const found = has(rec.quote) && (rec.contextQuote === undefined || has(rec.contextQuote));
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

const [a, b, c] = process.argv.slice(2);
if (a === '--robots') {
  for (const u of process.argv.slice(3)) {
    const r = await robotsAllows(u);
    console.log(`${r.allowed ? 'PERMITIDO' : 'BLOQUEADO'}  ${u}  (${r.note})`);
    await sleep(500);
  }
} else if (a === '--probe') await probe(b, c);
else if (a) await verify(a);
else console.log('uso: node scripts/verify-dataset.mjs <dataset.json> | --probe <url> <palavra>');
