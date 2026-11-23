/**
 * Shadow por replay das respostas reais (sem chamadas novas). Validação cruzada simples para não "decorar" a resposta:
 * o roteador adaptativo é semeado só com as URLs de ÍNDICE PAR e avaliado nas de índice ÍMPAR (e vice-versa).
 * Uso: npx tsx packages/scraping-benchmark/scripts/shadow-replay.ts <runId>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shadowRun } from '../src/shadow.ts';
import { rejudgeRecord } from '../src/quality.ts';
const CRITERION = (process.argv[3] ?? 'v2') as 'v1' | 'v2';
import type { AttemptRecord, DatasetEntry } from '../src/types.ts';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2] ?? 'run-20261123-01';
const dir = join(PKG, 'data', 'runs', runId);
const ds: DatasetEntry[] = JSON.parse(readFileSync(join(PKG, 'data', 'dataset.json'), 'utf8'));
const ids = new Set(ds.map((d) => d.id));
const recs: AttemptRecord[] = readFileSync(join(dir, 'attempts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r: AttemptRecord) => !r.mock && ids.has(r.urlId));
// último registro por par (o complemento do Scrapfly substitui o corte por orçamento)
const last = new Map<string, AttemptRecord>();
for (const r of recs) if (r.errorClass !== 'budget_blocked' || !last.has(`${r.urlId}|${r.provider}`)) last.set(`${r.urlId}|${r.provider}`, r);
const refOf = new Map(ds.map((d) => [d.id, d.referenceTitle]));
const R = [...last.values()].map((r) => (CRITERION === 'v2' && r.errorClass !== 'budget_blocked' ? rejudgeRecord(r, refOf.get(r.urlId)!) : r));
const USD: Record<string, number> = { direct: 0, 'scrapfly-basic': 30 / 200_000, 'zyte-http': 0.0001, 'exa-contents': 0.001, 'tavily-extract': 0.008, 'brightdata-unlocker': 0.0015, 'apify-rag-web-browser': 0.001, 'firecrawl-scrape': 19 / 5000 };
const ALL = Object.keys(USD);
const eligible = ds.filter((d) => !d.paywall);
const even = eligible.filter((_, i) => i % 2 === 0).map((d) => d.url);
const odd = eligible.filter((_, i) => i % 2 === 1).map((d) => d.url);
const seed = (urls: string[]) => R.filter((r) => urls.includes(r.url));

const results = [
  await shadowRun('atual: direct → tavily', eligible.map((d) => d.url), R, ['direct', 'tavily-extract'], USD, { adaptive: false }),
  await shadowRun('cascata fixa por preço: direct → zyte → scrapfly → brightdata → exa → tavily → apify', eligible.map((d) => d.url), R, ['direct', 'zyte-http', 'scrapfly-basic', 'brightdata-unlocker', 'exa-contents', 'tavily-extract', 'apify-rag-web-browser'], USD, { adaptive: false }),
];
const a1 = await shadowRun('adaptativo (semeado em pares, avaliado em ímpares)', odd, R, ALL, USD, { adaptive: true, seedFrom: seed(even) });
const a2 = await shadowRun('adaptativo (semeado em ímpares, avaliado em pares)', even, R, ALL, USD, { adaptive: true, seedFrom: seed(odd) });
const adaptive = { path: 'adaptativo (validação cruzada 2 dobras)', urls: a1.urls + a2.urls, valid: a1.valid + a2.valid, attempts: a1.attempts + a2.attempts, fallbacks: a1.fallbacks + a2.fallbacks, creditsUsdEquiv: +(a1.creditsUsdEquiv + a2.creditsUsdEquiv).toFixed(5), usdPerValid: +((a1.creditsUsdEquiv + a2.creditsUsdEquiv) / Math.max(1, a1.valid + a2.valid)).toFixed(6), stopsByRestriction: a1.stopsByRestriction + a2.stopsByRestriction, decisions: a1.decisions + a2.decisions };
const adPer = [...(a1.perUrl ?? []), ...(a2.perUrl ?? [])];
const adLat = adPer.map((p) => p.latencyMs).sort((x, y) => x - y);
const qa = (x: number) => adLat[Math.min(adLat.length - 1, Math.ceil(x * adLat.length) - 1)] ?? null;
results.push({ ...adaptive, perUrl: adPer, latencyP50Ms: qa(0.5), latencyP95Ms: qa(0.95) } as typeof adaptive);
// divergências por URL entre o caminho atual e o adaptativo (o que muda para o pipeline)
const cur = new Map((results[0]!.perUrl ?? []).map((p) => [p.url, p]));
const divergences = ([...(a1.perUrl ?? []), ...(a2.perUrl ?? [])]).filter((p) => cur.get(p.url)?.valid !== p.valid || cur.get(p.url)?.provider !== p.provider).map((p) => ({ url: p.url, atual: cur.get(p.url)?.valid ? cur.get(p.url)?.provider : 'falha', adaptativo: p.valid ? p.provider : 'falha', latAtualMs: cur.get(p.url)?.latencyMs, latAdaptMs: p.latencyMs }));
writeFileSync(join(dir, CRITERION === 'v2' ? 'shadow.json' : 'shadow-v1-historico.json'), JSON.stringify({ runId, criterion: CRITERION, note: 'replay das respostas reais medidas; nenhuma chamada nova; nada publicado', eligible: eligible.length, results, divergences }, null, 2));
console.log(`divergências atual × adaptativo: ${divergences.length}`);
for (const r of results) console.log(`latência ${r.path}: p50 ${r.latencyP50Ms} ms, p95 ${r.latencyP95Ms} ms`);
for (const r of results) console.log(`${r.path}: válidos ${r.valid}/${r.urls} (${((100 * r.valid) / r.urls).toFixed(1)}%), tentativas ${r.attempts}, fallbacks ${r.fallbacks}, US$ ${r.creditsUsdEquiv} (US$/válido ${r.usdPerValid})`);
