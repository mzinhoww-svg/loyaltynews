/**
 * Ressalva QA 3 (M1): as URLs "com problema"/"restritivas" devem vir de fontes SEM feed ou BLOQUEADAS (não de feeds RSS).
 * Descoberta pela busca Exa restrita ao domínio (ExaDiscoverer do Data): só link, título e data. Custo registrado no ledger.
 * Hosts e motivo do problema vêm das notas do cadastro (packages/editorial/src/sources/seed.ts) e da rodada de descoberta.
 * Uso: npx tsx packages/scraping-benchmark/scripts/discover-problem.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExaDiscoverer } from '@ln/intelligence';
import { BudgetGuard } from '../src/budget.ts';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = 'C:/Users/mazin/OpenBot/Shared/loyalty-news/scraping-benchmark';
const VAULT = process.env.LN_VAULT_DIR ?? 'C:/Users/mazin/AppData/Roaming/OpenBot/agent-api-keys/.vault/agent-2668b5a1-5627-4692-a689-8524a4d5d3ef';
const secret = (n: string) => {
  const f = join(VAULT, n);
  if (!existsSync(f)) return undefined;
  let v = readFileSync(f, 'utf8').trim();
  if (v.startsWith('{')) try { const j = JSON.parse(v); v = String(j.value ?? j.apiKey ?? j.key ?? ''); } catch { /* texto */ }
  return v || undefined;
};

export const PROBLEM_HOSTS: Array<{ host: string; category: 'fintech' | 'restritivo'; country: string; language: string; problem: string; feed: 'sem-feed' | 'feed-quebrado' | 'bloqueado' }> = [
  // fintech (5): sem feed ou bloqueados
  { host: 'nu.com', category: 'fintech', country: 'BR', language: 'en', problem: 'sem RSS (só sitemap)', feed: 'sem-feed' },
  { host: 'livelo.com.br', category: 'fintech', country: 'BR', language: 'pt', problem: 'sem RSS; imprensa só no sitemap', feed: 'sem-feed' },
  { host: 'santander.com.br', category: 'fintech', country: 'BR', language: 'pt', problem: '403 do CDN (seed.ts)', feed: 'bloqueado' },
  { host: 'itau.com.br', category: 'fintech', country: 'BR', language: 'pt', problem: '403 até no robots.txt (seed.ts)', feed: 'bloqueado' },
  { host: 'finextra.com', category: 'fintech', country: 'GB', language: 'en', problem: 'feed 403 ao UA (descoberta 23/11)', feed: 'bloqueado' },
  // restritivos (15)
  { host: 'latamairlines.com', category: 'restritivo', country: 'CL', language: 'pt', problem: '403 ao fetch (seed.ts)', feed: 'bloqueado' },
  { host: 'staralliance.com', category: 'restritivo', country: 'INT', language: 'en', problem: '403 no robots.txt (seed.ts)', feed: 'bloqueado' },
  { host: 'ri.voegol.com.br', category: 'restritivo', country: 'BR', language: 'pt', problem: 'RSS anunciado retorna 404 (seed.ts)', feed: 'feed-quebrado' },
  { host: 'gov.br/anpd', category: 'restritivo', country: 'BR', language: 'pt', problem: 'lista carregada por JavaScript, sem RSS (seed.ts)', feed: 'sem-feed' },
  { host: 'edpb.europa.eu', category: 'restritivo', country: 'EU', language: 'en', problem: 'feed 503 (seed.ts)', feed: 'feed-quebrado' },
  { host: 'aeroin.net', category: 'restritivo', country: 'BR', language: 'pt', problem: 'feed 404 (descoberta 23/11)', feed: 'feed-quebrado' },
  { host: 'bradescori.com.br', category: 'restritivo', country: 'BR', language: 'pt', problem: 'sem RSS (seed.ts)', feed: 'sem-feed' },
  { host: 'oneworld.com', category: 'restritivo', country: 'INT', language: 'en', problem: 'sem RSS (só sitemap)', feed: 'sem-feed' },
];

const exa = new ExaDiscoverer({ keys: [{ label: 'conta-1', secretRef: 'EXA_API_KEY', monthlyCreditCap: 200 }], resolveSecret: secret });
const budget = new BudgetGuard({ 'exa-search': { provider: 'exa-search', billing: 'free-confirmed', billingEvidence: 'DP-33 + crédito gratuito', creditCap: 100, usdPerCredit: 0.001, account: 'conta-1', unit: 'US$ 0,001 (busca lite ≈ 4)', alertAt: 8_000, accountQuota: 10_000 } }, join(SHARED, 'checkpoints', 'ledger.json'));
const out: unknown[] = [];
for (const h of PROBLEM_HOSTS) {
  const chk = budget.check('exa-search', 4);
  if (!chk.ok) { console.log(`corte: ${chk.reason}`); break; }
  const t0 = Date.now();
  try {
    const links = await exa.discover({ host: h.host, limit: 8, query: 'notícia comunicado imprensa press release news' });
    budget.record('exa-search', 4);
    for (const l of links) out.push({ ...h, url: l.url, title: (l.title ?? '').slice(0, 300), publishedAt: l.publishedAt ?? null, discoveryMethod: 'exa-search' });
    console.log(`${h.host}: ${links.length} links ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`${h.host}: erro ${String((e as Error).message).slice(0, 100)}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
writeFileSync(join(PKG, 'data', 'problem-candidates.json'), JSON.stringify(out, null, 2));
console.log(`candidatos: ${out.length}`);
