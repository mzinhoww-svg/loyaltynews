/**
 * Seleção determinística das 100 URLs a partir de data/candidates.json (descoberta real).
 * Cotas (Diretiva V3 §8): financeiro 25, fintech 20, aviação/fidelidade 20, tecnologia 15, restritivo 15, internacional 5.
 * Recência: 60 recentes, 20 históricos (página antiga do feed), 20 com problema (15 restritivos + 5 BCB/SPA).
 * Round-robin entre feeds da categoria para não concentrar num domínio. Nenhuma URL inventada: tudo vem do feed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
interface Cand { url: string; title: string; publishedAt: string | null; page: 'recente' | 'historico'; feed: string; category: string; country: string; language: string; method: string; note: string | null }
const cands: Cand[] = JSON.parse(readFileSync(join(DATA, 'candidates.json'), 'utf8'));

const PLAN: Array<{ category: string; recency: 'recente' | 'historico' | 'problema'; n: number; filter: (c: Cand) => boolean }> = [
  { category: 'financeiro', recency: 'historico', n: 6, filter: (c) => c.category === 'financeiro' && c.page === 'historico' },
  { category: 'financeiro', recency: 'recente', n: 19, filter: (c) => c.category === 'financeiro' && c.page === 'recente' },
  { category: 'fintech', recency: 'problema', n: 5, filter: (c) => c.feed.includes('bcb.gov.br') },
  { category: 'fintech', recency: 'historico', n: 4, filter: (c) => c.category === 'fintech' && c.page === 'historico' },
  { category: 'fintech', recency: 'recente', n: 11, filter: (c) => c.category === 'fintech' && c.page === 'recente' && !c.feed.includes('bcb.gov.br') },
  { category: 'aviacao-fidelidade', recency: 'historico', n: 5, filter: (c) => c.category === 'aviacao-fidelidade' && c.page === 'historico' },
  { category: 'aviacao-fidelidade', recency: 'recente', n: 15, filter: (c) => c.category === 'aviacao-fidelidade' && c.page === 'recente' },
  { category: 'tecnologia', recency: 'historico', n: 5, filter: (c) => c.category === 'tecnologia' && c.page === 'historico' },
  { category: 'tecnologia', recency: 'recente', n: 10, filter: (c) => c.category === 'tecnologia' && c.page === 'recente' },
  { category: 'restritivo', recency: 'problema', n: 15, filter: (c) => c.category === 'restritivo' },
  { category: 'internacional', recency: 'recente', n: 5, filter: (c) => c.category === 'internacional' },
];

const ARTICLE = (u: string) => {
  try {
    const p = new URL(u).pathname;
    return p.length > 12 && !/\/(tag|category|categoria|author|autor|page|feed)\//i.test(p);
  } catch {
    return false;
  }
};
const norm = (u: string) => u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
const used = new Set<string>();
const out: unknown[] = [];

const DIFF: Record<string, 'baixa' | 'media' | 'alta'> = { restritivo: 'alta' };
for (const step of PLAN) {
  const pool = cands.filter((c) => step.filter(c) && ARTICLE(c.url) && c.title);
  const byFeed = new Map<string, Cand[]>();
  for (const c of pool) byFeed.set(c.feed, [...(byFeed.get(c.feed) ?? []), c]);
  const feeds = [...byFeed.keys()].sort();
  let picked = 0;
  for (let round = 0; picked < step.n && round < 100; round++) {
    for (const f of feeds) {
      if (picked >= step.n) break;
      const c = byFeed.get(f)![round];
      if (!c || used.has(norm(c.url))) continue;
      used.add(norm(c.url));
      picked++;
      const domain = new URL(c.url).hostname.replace(/^www\./, '');
      const paywall = /folha|estadao|valor\.globo/.test(domain);
      out.push({
        id: `u${String(out.length + 1).padStart(3, '0')}`,
        url: c.url,
        domain,
        category: step.category,
        recency: step.recency,
        country: c.country,
        language: c.language,
        publishedAt: c.publishedAt,
        contentType: /gov\.br|leg\.br|iata|airlines\.org|ir\.latam|brasscom/.test(domain) ? (/ir\.latam|iata/.test(domain) ? 'release' : 'nota-oficial') : 'noticia',
        difficulty: DIFF[step.category] ?? (step.recency === 'problema' ? 'alta' : 'baixa'),
        discoveryMethod: c.method,
        discoverySource: c.feed,
        accessCondition: paywall ? 'paywall-parcial' : step.recency === 'problema' ? 'bloqueio-tecnico' : 'publico',
        paywall,
        needsJs: c.feed.includes('bcb.gov.br') ? true : null,
        errorHistory: c.note,
        referenceTitle: c.title,
      });
    }
  }
  if (picked < step.n) console.error(`FALTOU ${step.category}/${step.recency}: ${picked}/${step.n}`);
}
writeFileSync(join(DATA, 'dataset.json'), JSON.stringify(out, null, 2));
console.log(`dataset: ${out.length} URLs únicas`);
