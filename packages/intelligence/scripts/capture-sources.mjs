#!/usr/bin/env node
/**
 * Captura LOCAL do texto de páginas públicas para verificação de citações (intelligence-seed/1, source.method = "capture").
 * Por URL: robots.txt (não busca se proíbe/ilegível), UMA requisição, pausa de 2 s, User-Agent identificado, sem repetir,
 * sem contornar 403/429/CAPTCHA. Grava:
 *   data/captures/<id>.json       texto da página (LOCAL, ignorado pelo git: não reproduzimos páginas de terceiros no repositório)
 *   data/captures/<id>.meta.json  metadados SEM texto (url, data, robots, tamanho, sha256) — este SIM vai para o git
 * A verificação (verify-dataset.mjs) lê o texto local e recalcula o sha256; sem o texto local só é possível reverificar recapturando.
 *
 * Uso: node scripts/capture-sources.mjs <candidatos.json> <id> [<id>…] [--show <regex>]
 *      --show imprime trechos curtos (≤ 240 caracteres) que casam com o regex, para triagem humana; não grava os trechos.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { robotsAllows, fetchText } from './verify-dataset.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const showAt = args.indexOf('--show');
const showRe = showAt >= 0 ? new RegExp(args[showAt + 1], 'gi') : null;
const rest = showAt >= 0 ? args.slice(0, showAt) : args;
const [candPath, ...ids] = rest;
if (!candPath || ids.length === 0) {
  console.error('uso: node scripts/capture-sources.mjs <candidatos.json> <id> [<id>…] [--show <regex>]');
  process.exit(2);
}
const cand = JSON.parse(readFileSync(candPath, 'utf8'));
const dir = join(dirname(candPath), 'captures');
mkdirSync(dir, { recursive: true });

for (const id of ids) {
  const src = cand.fontes.find((f) => f.id === id);
  if (!src) { console.log(`${id}: não está na lista de candidatas`); continue; }
  const rb = await robotsAllows(src.url);
  if (!rb.allowed) { console.log(`${id}: NÃO capturada (${rb.note})`); await sleep(1000); continue; }
  await sleep(1000);
  try {
    const f = await fetchText(src.url);
    if (f.estado === 'redirecionada') { console.log(`${id}: ${f.observacao} -> ${f.location ?? '(sem Location)'}; cadastre o destino como candidata própria`); await sleep(2000); continue; }
    if (f.estado !== 'ok') { console.log(`${id}: ${f.estado} — ${f.observacao}`); await sleep(2000); continue; }
    const sha = createHash('sha256').update(f.text).digest('hex');
    const meta = { method: 'http', id, url: src.url, finalUrl: f.finalUrl, capturedAt: new Date().toISOString(), robots: rb.note, length: f.text.length, sha256Claimed: sha };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...meta, text: f.text }, null, 2) + '\n');
    writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2) + '\n');
    console.log(`${id}: ok ${f.text.length} caracteres sha256=${sha.slice(0, 12)}…`);
    if (showRe) {
      let m, n = 0, last = -999;
      while ((m = showRe.exec(f.text)) && n < 6) {
        if (m.index - last < 200) continue;
        last = m.index; n++;
        console.log(`    …${f.text.slice(Math.max(0, m.index - 100), m.index + 140)}…`);
      }
    }
  } catch (e) {
    console.log(`${id}: erro ${e.name}`);
  }
  await sleep(2000);
}
