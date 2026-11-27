/**
 * Monta o dataset de 100 URLs REAIS a partir de feeds/sitemaps públicos (custo zero; leitura direta, 1 por host, ritmo baixo).
 * Grava: data/discovery-metrics.json (Experimento A) e data/candidates.json (todos os itens descobertos, só link/título/data).
 * A seleção final (data/dataset.json) é feita por select-dataset.ts, que aplica as cotas por categoria e recência.
 * Uso: node --experimental-strip-types packages/scraping-benchmark/scripts/build-dataset.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed, discoveryMetrics } from '../src/discovery.ts';
import { politeGet } from '../src/polite-get.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'data');
const UA = 'LoyaltyNewsBenchmark/0.1 (+pesquisa de ingestao; ritmo baixo)';

type Cat = 'financeiro' | 'fintech' | 'aviacao-fidelidade' | 'tecnologia' | 'restritivo' | 'internacional';
interface Src { feed: string; cat: Cat; country: string; lang: string; method: 'rss' | 'atom' | 'sitemap'; note?: string; historicPage?: string }

// Feeds públicos. "historicPage" = página antiga do feed WordPress (?paged=N) para a parte histórica da amostra.
export const SOURCES: Src[] = [
  // financeiro e negócios
  { feed: 'https://www.infomoney.com.br/feed/', cat: 'financeiro', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://www.infomoney.com.br/feed/?paged=60' },
  { feed: 'https://www.moneytimes.com.br/feed/', cat: 'financeiro', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://www.moneytimes.com.br/feed/?paged=60' },
  { feed: 'https://www.seudinheiro.com/feed/', cat: 'financeiro', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://www.seudinheiro.com/feed/?paged=60' },
  { feed: 'https://exame.com/feed/', cat: 'financeiro', country: 'BR', lang: 'pt', method: 'rss' },
  { feed: 'https://www.gov.br/cvm/pt-br/assuntos/noticias/2026/rss.xml', cat: 'financeiro', country: 'BR', lang: 'pt', method: 'rss' },
  { feed: 'https://www12.senado.leg.br/noticias/rss.xml', cat: 'financeiro', country: 'BR', lang: 'pt', method: 'rss' },
  { feed: 'https://www.mercadoeconsumo.com.br/feed/', cat: 'financeiro', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://www.mercadoeconsumo.com.br/feed/?paged=60' },
  // fintech e pagamentos
  { feed: 'https://finsidersbrasil.com.br/feed/', cat: 'fintech', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://finsidersbrasil.com.br/feed/?paged=40' },
  { feed: 'https://www.mobiletime.com.br/feed/', cat: 'fintech', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://www.mobiletime.com.br/feed/?paged=60' },
  { feed: 'https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias?ano=2026', cat: 'fintech', country: 'BR', lang: 'pt', method: 'atom', note: 'paginas HTML do BCB sao SPA (seed.ts)' },
  { feed: 'https://www.finextra.com/rss/headlines.aspx', cat: 'fintech', country: 'GB', lang: 'en', method: 'rss' },
  { feed: 'https://www.paymentsdive.com/feeds/news/', cat: 'fintech', country: 'US', lang: 'en', method: 'rss' },
  { feed: 'https://www.pymnts.com/feed/', cat: 'fintech', country: 'US', lang: 'en', method: 'rss' },
  // aviação e fidelidade
  { feed: 'https://passageirodeprimeira.com/feed/', cat: 'aviacao-fidelidade', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://passageirodeprimeira.com/feed/?paged=80' },
  { feed: 'https://www.melhoresdestinos.com.br/feed', cat: 'aviacao-fidelidade', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://www.melhoresdestinos.com.br/feed?paged=80' },
  { feed: 'https://aeroin.net/feed/', cat: 'aviacao-fidelidade', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://aeroin.net/feed/?paged=80' },
  { feed: 'https://www.iata.org/api/rss/pressrelease', cat: 'aviacao-fidelidade', country: 'INT', lang: 'en', method: 'rss' },
  { feed: 'https://www.airlines.org/feed/', cat: 'aviacao-fidelidade', country: 'US', lang: 'en', method: 'rss' },
  { feed: 'https://www.pontospravoar.com/feed', cat: 'aviacao-fidelidade', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://www.pontospravoar.com/feed?paged=60' },
  // tecnologia e inovação
  { feed: 'https://tecnoblog.net/feed/', cat: 'tecnologia', country: 'BR', lang: 'pt', method: 'rss', historicPage: 'https://tecnoblog.net/feed/?paged=80' },
  { feed: 'https://olhardigital.com.br/feed/', cat: 'tecnologia', country: 'BR', lang: 'pt', method: 'rss' },
  { feed: 'https://canaltech.com.br/rss/', cat: 'tecnologia', country: 'BR', lang: 'pt', method: 'rss' },
  { feed: 'https://brasscom.org.br/feed/', cat: 'tecnologia', country: 'BR', lang: 'pt', method: 'rss' },
  // tecnicamente restritivos (paywall parcial, 403 a UA, SPA ou anti-bot documentado)
  { feed: 'https://ir.latam.com/rss/pressrelease.aspx', cat: 'restritivo', country: 'CL', lang: 'en', method: 'rss', note: '403 ao UA direto (seed.ts)' },
  { feed: 'https://www.camara.leg.br/noticias/rss/ultimas-noticias', cat: 'restritivo', country: 'BR', lang: 'pt', method: 'rss', note: 'robots declara bloqueio de bots de IA (seed.ts)' },
  { feed: 'https://feeds.folha.uol.com.br/mercado/rss091.xml', cat: 'restritivo', country: 'BR', lang: 'pt', method: 'rss', note: 'paywall poroso' },
  { feed: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/', cat: 'restritivo', country: 'BR', lang: 'pt', method: 'rss', note: 'paywall' },
  { feed: 'https://www.bloomberglinea.com.br/arc/outboundfeeds/rss/?outputType=xml', cat: 'restritivo', country: 'BR', lang: 'pt', method: 'rss', note: 'anti-bot' },
  { feed: 'https://valor.globo.com/rss/valor', cat: 'restritivo', country: 'BR', lang: 'pt', method: 'rss', note: 'paywall' },
  // internacionais adicionais
  { feed: 'https://thepointsguy.com/feed/', cat: 'internacional', country: 'US', lang: 'en', method: 'rss' },
  { feed: 'https://simpleflying.com/feed/', cat: 'internacional', country: 'US', lang: 'en', method: 'rss' },
  { feed: 'https://onemileatatime.com/feed/', cat: 'internacional', country: 'US', lang: 'en', method: 'rss' },
];

async function get(url: string) {
  const t0 = Date.now();
  try {
    const r = await politeGet(url, { userAgent: UA, accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' }); // robots.txt e CAPTCHA (ADR-007)
    const ok = !r.err && r.status >= 200 && r.status < 300;
    return { status: r.status, body: ok ? r.body.toString('utf8') : '', ms: Date.now() - t0, ...(r.err ? { err: r.err } : {}) };
  } catch (e) {
    return { status: 0, body: '', ms: Date.now() - t0, err: String((e as Error).message ?? e).slice(0, 120) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(DATA, { recursive: true });
  const now = new Date();
  const metrics: unknown[] = [];
  const candidates: unknown[] = [];
  for (const s of SOURCES) {
    for (const [which, url] of [['recente', s.feed], ['historico', s.historicPage]] as const) {
      if (!url) continue;
      const r = await get(url);
      const parsed = r.body ? parseFeed(r.body) : { kind: 'unknown' as const, items: [] };
      metrics.push({ ...discoveryMetrics(url, s.method, parsed.items, r.ms, now, { httpStatus: r.status }), page: which, category: s.cat, parsedAs: parsed.kind, error: (r as { err?: string }).err });
      for (const it of parsed.items.slice(0, 40)) candidates.push({ ...it, title: it.title.slice(0, 300), page: which, feed: url, category: s.cat, country: s.country, language: s.lang, method: s.method, note: s.note ?? null });
      console.log(`${String(r.status).padStart(3)} ${parsed.kind.padEnd(8)} ${String(parsed.items.length).padStart(3)} ${which.padEnd(9)} ${url}`);
      await sleep(3_000); // ritmo baixo: hosts diferentes em sequência, 1 requisição por vez
    }
  }
  writeFileSync(join(DATA, 'discovery-metrics.json'), JSON.stringify({ at: now.toISOString(), costUsd: 0, sources: metrics }, null, 2));
  writeFileSync(join(DATA, 'candidates.json'), JSON.stringify(candidates, null, 2));
  console.log(`candidatos: ${candidates.length}`);
}

main();
