/**
 * Dataset v1.1: a "página antiga do feed" não garantiu antiguidade (mediana de 4 dias em sites de alto volume).
 * Reclassifica a recência pela data real (> 30 dias = histórico) e troca entradas "historico" que na verdade são recentes por
 * candidatas reais com > 30 dias da MESMA categoria, com IDs novos (u101+), até fechar 20 históricos. Registra as trocas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Linhas JSON de dataset/candidatos (script de uso único; campos heterogêneos).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const NOW = Date.parse('2026-11-23T00:00:00Z');
const ds = JSON.parse(readFileSync(join(DATA, 'dataset.json'), 'utf8')) as Row[];
const cands = JSON.parse(readFileSync(join(DATA, 'candidates.json'), 'utf8')) as Row[];
const age = (iso: string | null) => (iso ? (NOW - Date.parse(iso)) / 864e5 : 0);
const norm = (u: string) => u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
const used = new Set(ds.map((d) => norm(d.url)));

for (const d of ds) if (d.recency !== 'problema') d.recency = age(d.publishedAt) > 30 ? 'historico' : 'recente';
let hist = ds.filter((d) => d.recency === 'historico').length;
let recent = ds.filter((d) => d.recency === 'recente').length;
const swaps: Array<{ out: string; in: string; category: string }> = [];
let next = 101;
// troca recentes (preferindo as que vieram da "página antiga") por históricas reais da mesma categoria
const order = ds.filter((d) => d.recency === 'recente').sort((a, b) => (String(b.discoverySource).includes('paged=') ? 1 : 0) - (String(a.discoverySource).includes('paged=') ? 1 : 0));
for (const d of order) {
  if (hist >= 20) break;
  const c = cands.find((x) => x.category === d.category && age(x.publishedAt) > 30 && x.title && !used.has(norm(x.url)) && new URL(x.url).pathname.length > 12);
  if (!c) continue;
  used.add(norm(c.url));
  const id = `u${next++}`;
  const domain = new URL(c.url).hostname.replace(/^www\./, '');
  const idx = ds.indexOf(d);
  ds[idx] = { ...d, id, url: c.url, domain, recency: 'historico', country: c.country, language: c.language, publishedAt: c.publishedAt, discoveryMethod: c.method, discoverySource: c.feed, errorHistory: c.note, referenceTitle: c.title, replaces: d.id };
  swaps.push({ out: d.id, in: id, category: d.category });
  hist++;
  recent--;
}
writeFileSync(join(DATA, 'dataset.json'), JSON.stringify(ds, null, 2));
writeFileSync(join(DATA, 'dataset-v1.1-changes.json'), JSON.stringify({ reason: 'recência pela data real (> 30 dias); página antiga do feed não garantiu antiguidade', swaps, counts: { recente: recent, historico: hist, problema: ds.filter((d) => d.recency === 'problema').length } }, null, 2));
console.log(JSON.stringify({ swaps, recente: recent, historico: hist }));
