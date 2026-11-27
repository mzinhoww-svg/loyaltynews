/**
 * Rodada REAL do benchmark (Experimento B) sobre data/dataset.json. Executar destacado (nohup); retoma do checkpoint.
 * Segredos: lidos do cofre só dentro do processo; nunca impressos nem gravados. Resultados: só métricas, título, data, tamanho,
 * hash e trecho ≤ 200 (DP-29/DP-32). Teto: abaixo da cota gratuita de cada provedor (DP-33: corte quando a cota acaba).
 * Uso: node --experimental-strip-types --import ./packages/scraping-benchmark/scripts/register.mjs \
 *        packages/scraping-benchmark/scripts/run-live.ts <runId> [provedores separados por vírgula]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createReader, createRobotsGate, ScrapflyReader, ZyteReader, ApifyRagBrowserReader, ExaContentsReader, BrightDataUnlockerReader } from '@ln/intelligence';
import type { KeyedReader } from '@ln/intelligence';
import { BudgetGuard, type ProviderBudget } from '../src/budget.ts';
import { DirectReader } from '../src/direct-reader.ts';
import { TavilyExtractReader } from '../src/tavily.ts';
import { FirecrawlReader } from '../src/firecrawl.ts';
import { runBenchmark, type BenchProvider } from '../src/runner.ts';
import type { DatasetEntry } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, '..');
const SHARED = 'C:/Users/mazin/OpenBot/Shared/loyalty-news/scraping-benchmark';
const VAULT = process.env.LN_VAULT_DIR ?? 'C:/Users/mazin/AppData/Roaming/OpenBot/agent-api-keys/.vault/agent-2668b5a1-5627-4692-a689-8524a4d5d3ef';
const runId = process.argv[2] ?? `run-${new Date().toISOString().slice(0, 10)}`;
const only = process.argv[3]?.split(',');

function secret(name: string): string | undefined {
  const f = join(VAULT, name);
  if (!existsSync(f)) return undefined;
  let v = readFileSync(f, 'utf8').trim();
  if (v.startsWith('{')) {
    try {
      const j = JSON.parse(v) as Record<string, unknown>;
      v = String(j.value ?? j.apiKey ?? j.key ?? j.secret ?? '');
    } catch {
      /* texto puro */
    }
  }
  return v || undefined;
}

// Teto do benchmark por provedor (créditos no mês), abaixo da cota gratuita; preço só para custo EQUIVALENTE estimado.
const BUDGETS: Record<string, ProviderBudget> = {
  'scrapfly-basic': { provider: 'scrapfly-basic', billing: 'free-confirmed', billingEvidence: 'DP-33 + plano FREE 1.000/mês', creditCap: 600, usdPerCredit: 30 / 200_000, account: 'conta-1', unit: '1 crédito Scrapfly (x-scrapfly-api-cost)', alertAt: 800, accountQuota: 1_000 },
  'scrapfly-asp': { provider: 'scrapfly-asp', billing: 'free-confirmed', billingEvidence: 'DP-33', creditCap: 500, usdPerCredit: 30 / 200_000, account: 'conta-1', unit: '1 crédito Scrapfly (x-scrapfly-api-cost)', alertAt: 800, accountQuota: 1_000 },
  'zyte-http': { provider: 'zyte-http', billing: 'free-confirmed', billingEvidence: 'DP-33 + crédito US$ 5 inicial', creditCap: 3_000, usdPerCredit: 0.0001, account: 'conta-1', unit: 'US$ 0,0001 (estimado: a Zyte não informa custo por resposta)', alertAt: 40_000, accountQuota: 50_000 },
  'apify-rag-web-browser': { provider: 'apify-rag-web-browser', billing: 'free-confirmed', billingEvidence: 'DP-33 + FREE US$ 5/mês', creditCap: 1_000, usdPerCredit: 0.001, account: 'conta-1', unit: 'US$ 0,001 (estimado; real em usageTotalUsd da execução)', alertAt: 4_000, accountQuota: 5_000 },
  'exa-contents': { provider: 'exa-contents', billing: 'free-confirmed', billingEvidence: 'DP-33 + crédito gratuito', creditCap: 200, usdPerCredit: 0.001, account: 'conta-1', unit: 'US$ 0,001 = costDollars.total da resposta, arredondado p/ cima', alertAt: 8_000, accountQuota: 10_000 },
  'brightdata-unlocker': { provider: 'brightdata-unlocker', billing: 'free-confirmed', billingEvidence: 'DP-33 + conta 2 com zona web_unlocker1, 5.000/mês', creditCap: 300, usdPerCredit: 1.5 / 1000, account: 'conta-2', unit: '1 requisição Web Unlocker (Browser API = 5/MB, não usado)', alertAt: 4_000, accountQuota: 5_000 },
  'firecrawl-scrape': { provider: 'firecrawl-scrape', billing: 'free-confirmed', billingEvidence: 'DP-33; /v1/team/credit-usage lido pelo PM em 23/11: plan_credits 1.000/mês (período 23/11–23/12); preço Hobby mensal US$ 19 / 5.000, firecrawl.dev/pricing', creditCap: 150, usdPerCredit: 19 / 5000, account: 'conta-1', unit: '1 crédito Firecrawl por scrape', alertAt: 800, accountQuota: 1_000 },
  'tavily-extract': { provider: 'tavily-extract', billing: 'free-confirmed', billingEvidence: 'DP-33 + Researcher 1.000/mês', creditCap: 60, usdPerCredit: 0.008, account: 'conta-2', unit: '1 crédito Tavily (0,2 por extract basic bem-sucedido)', alertAt: 800, accountQuota: 1_000 },
};

function pooled(keyed: KeyedReader, keyName: string, cap: number) {
  return createReader({ keyed, keys: [{ label: 'conta', secretRef: keyName, monthlyCreditCap: cap }], resolveSecret: secret, robots: createRobotsGate() }, { enabled: true, pace: false });
}

/** Espaço mínimo entre chamadas ao MESMO provedor (Firecrawl Free ≈ 10/min). */
function spaced<T extends { read: (r: { url: string; purpose?: 'discovery' | 'read' }) => Promise<unknown> }>(reader: T, ms: number): T {
  let last = 0;
  const orig = reader.read.bind(reader);
  (reader as { read: unknown }).read = async (r: { url: string; purpose?: 'discovery' | 'read' }) => {
    const wait = last + ms - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    last = Date.now();
    return orig(r);
  };
  return reader;
}

const all: BenchProvider[] = [
  { name: 'direct', reader: new DirectReader(), worstCaseCredits: 0 },
  { name: 'scrapfly-basic', mode: 'basic', reader: pooled(new ScrapflyReader('basic'), 'SCRAPFLY_API_KEY', 600), worstCaseCredits: 6 },
  { name: 'zyte-http', mode: 'http', reader: pooled(new ZyteReader('http'), 'ZYTE_API_KEY', 3_000), worstCaseCredits: 13 },
  { name: 'exa-contents', reader: pooled(new ExaContentsReader(), 'EXA_API_KEY', 200), worstCaseCredits: 1 },
  { name: 'tavily-extract', reader: pooled(new TavilyExtractReader(), 'TAVILY_API_KEY_2', 60), worstCaseCredits: 1 },
  { name: 'brightdata-unlocker', reader: pooled(new BrightDataUnlockerReader('web_unlocker1'), 'BRIGHTDATA_API_KEY_2', 300), worstCaseCredits: 1 },
  { name: 'firecrawl-scrape', reader: spaced(pooled(new FirecrawlReader(), 'FIRECRAWL_API_KEY', 150), 6_500), worstCaseCredits: 1 },
  { name: 'apify-rag-web-browser', reader: pooled(new ApifyRagBrowserReader(), 'APIFY_API_TOKEN', 1_000), worstCaseCredits: 5 },
];
const providers = only ? all.filter((p) => only.includes(p.name)) : all;

const dataset: DatasetEntry[] = (JSON.parse(readFileSync(join(PKG, 'data', 'dataset.json'), 'utf8')) as DatasetEntry[]).slice(0, Number(process.env.LN_BENCH_LIMIT ?? 1e9));
const outDir = join(PKG, 'data', 'runs', runId);
mkdirSync(outDir, { recursive: true });
const sha = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();
const budget = new BudgetGuard(BUDGETS, join(SHARED, 'checkpoints', 'ledger.json'));
const log = join(SHARED, 'logs', `${runId}.log`);
let n = 0;
appendFileSync(log, `${new Date().toISOString()} inicio ${runId} provedores=${providers.map((p) => p.name).join(',')} sha=${sha}\n`);
await runBenchmark(dataset, providers, {
  experimentId: 'exp-b-extracao',
  runId,
  codeVersion: sha,
  outPath: join(outDir, 'attempts.jsonl'),
  budget,
  minSecondsPerHost: 15,
  maxAttempts: 800,
  onAttempt: (a) => {
    n++;
    appendFileSync(log, `${a.at} ${a.provider} ${a.urlId} ${a.errorClass} http=${a.httpStatus ?? '-'} ed=${a.editorialSuccess} ms=${a.durationMs} cr=${a.creditsUsed}\n`);
    if (n % 10 === 0) writeFileSync(join(SHARED, 'checkpoints', `${runId}.json`), JSON.stringify({ runId, attempts: n, last: a.at, ledger: budget.snapshot() }, null, 2));
  },
});
writeFileSync(join(SHARED, 'checkpoints', `${runId}.json`), JSON.stringify({ runId, attempts: n, done: true, at: new Date().toISOString(), ledger: budget.snapshot() }, null, 2));
appendFileSync(log, `${new Date().toISOString()} fim ${runId} tentativas=${n}\n`);
