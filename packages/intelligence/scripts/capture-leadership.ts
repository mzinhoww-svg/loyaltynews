/**
 * Captura de páginas PÚBLICAS de diretoria/administração (RI e "quem somos") para a seed v4.
 * Estratégia (ADR-007): só HTTP direto, com robots.txt respeitado. Recusa, CAPTCHA ou página vazia = não captura (a antiga reserva pela
 * Zyte, que desbloqueia sites, saiu). Grava:
 *   data/captures/<id>.json       texto da página (LOCAL, ignorado pelo git: não reproduzimos página de terceiros no repositório)
 *   data/captures/<id>.meta.json  metadados SEM texto (url, data, método, tamanho, sha256) — este vai para o git
 * Imprime só metadados e, com --show, um trecho curto do texto para triagem humana (nunca o texto inteiro, nunca segredo).
 * Uso: node node_modules/.cache/ln-intelligence/capture-leadership.mjs [--show <regex>] <id>=<url> …
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error módulo JS de scripts (sem tipos aqui); só as duas funções abaixo
import { fetchText, robotsAllows } from './verify-dataset.mjs';

const DIR = 'packages/intelligence/data/captures';
const args = process.argv.slice(2);
const showAt = args.indexOf('--show');
const show = showAt >= 0 ? new RegExp(args[showAt + 1]!, 'i') : null;
const targets = (showAt >= 0 ? args.filter((_, i) => i !== showAt && i !== showAt + 1) : args).map((a) => { const i = a.indexOf('='); return { id: a.slice(0, i), url: a.slice(i + 1) }; });
mkdirSync(DIR, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const t of targets) {
  let text = '';
  let method = '';
  let status: number | null = null;
  // 1) HTTP direto (só se o robots permitir)
  const rb = await robotsAllows(t.url);
  if (rb.allowed) {
    await sleep(1000);
    const f = await fetchText(t.url);
    status = f.status;
    if (f.estado === 'ok' && f.text.length >= 800) { text = f.text; method = 'http'; }
  }
  if (!text) { console.log(JSON.stringify({ id: t.id, url: t.url, capturado: false, httpStatusDireto: status })); continue; }
  const sha = createHash('sha256').update(text).digest('hex');
  const meta = { method, id: t.id, url: t.url, finalUrl: t.url, capturedAt: new Date().toISOString(), robots: rb.note, length: text.length, sha256Claimed: sha };
  writeFileSync(join(DIR, `${t.id}.json`), JSON.stringify({ ...meta, text }, null, 2) + '\n');
  writeFileSync(join(DIR, `${t.id}.meta.json`), JSON.stringify(meta, null, 2) + '\n');
  console.log(JSON.stringify({ id: t.id, capturado: true, metodo: method, caracteres: text.length, sha256: sha.slice(0, 12) }));
  if (show) {
    const m = show.exec(text);
    const from = m ? Math.max(0, m.index - 100) : 0;
    console.log(`   >>> ${text.slice(from, from + 1800)}`);
  }
  await sleep(2000);
}
