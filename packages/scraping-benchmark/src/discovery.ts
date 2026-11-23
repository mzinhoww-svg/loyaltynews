/**
 * Descoberta (Experimento A): RSS 2.0, RSS 1.0 (RDF), Atom e XML Sitemap (inclui news:sitemap). Só link, título e data.
 * Mede quantidade, frescor, duplicatas e latência; não avalia corpo do artigo (não penaliza RSS por isso).
 */
export interface DiscoveredItem {
  url: string;
  title: string;
  publishedAt: string | null;
}

const dec = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block: string, names: string[]): string | undefined => {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return dec(m[1] ?? '');
  }
  return undefined;
};

const iso = (s?: string) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function parseFeed(xml: string): { kind: 'rss' | 'atom' | 'sitemap' | 'sitemapindex' | 'unknown'; items: DiscoveredItem[] } {
  if (/<sitemapindex[\s>]/i.test(xml)) {
    const items = [...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)].map((m) => ({ url: tag(m[1] ?? '', ['loc']) ?? '', title: '', publishedAt: iso(tag(m[1] ?? '', ['lastmod'])) })).filter((i) => i.url);
    return { kind: 'sitemapindex', items };
  }
  if (/<urlset[\s>]/i.test(xml)) {
    const items = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)]
      .map((m) => ({
        url: tag(m[1] ?? '', ['loc']) ?? '',
        title: tag(m[1] ?? '', ['news:title', 'image:title']) ?? '',
        publishedAt: iso(tag(m[1] ?? '', ['news:publication_date', 'lastmod'])),
      }))
      .filter((i) => i.url);
    return { kind: 'sitemap', items };
  }
  if (/<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml)) {
    const items = [...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)].map((m) => {
      const b = m[1] ?? '';
      const href = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? tag(b, ['id']) ?? '';
      return { url: dec(href ?? ''), title: tag(b, ['title']) ?? '', publishedAt: iso(tag(b, ['published', 'updated'])) };
    });
    return { kind: 'atom', items: items.filter((i) => /^https?:/.test(i.url)) };
  }
  if (/<(rss|rdf:RDF)[\s>]/i.test(xml) || /<item[\s>]/i.test(xml)) {
    const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => {
      const b = m[1] ?? '';
      const about = m[0].match(/rdf:about=["']([^"']+)["']/i)?.[1];
      return { url: tag(b, ['link']) ?? about ?? tag(b, ['guid']) ?? '', title: tag(b, ['title']) ?? '', publishedAt: iso(tag(b, ['pubDate', 'dc:date', 'published', 'updated'])) };
    });
    return { kind: 'rss', items: items.filter((i) => /^https?:/.test(i.url)) };
  }
  return { kind: 'unknown', items: [] };
}

export interface DiscoveryMetrics {
  source: string;
  method: string;
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  items: number;
  unique: number;
  duplicates: number;
  withDate: number;
  fresh7d: number;
  newestAt: string | null;
  costUsd: number;
}

export function discoveryMetrics(source: string, method: string, items: DiscoveredItem[], latencyMs: number, now: Date, extra: Partial<DiscoveryMetrics> = {}): DiscoveryMetrics {
  const norm = (u: string) => u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const uniq = new Set(items.map((i) => norm(i.url)));
  const dates = items.map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : NaN)).filter((t) => !Number.isNaN(t));
  return {
    source,
    method,
    ok: items.length > 0,
    latencyMs,
    items: items.length,
    unique: uniq.size,
    duplicates: items.length - uniq.size,
    withDate: dates.length,
    fresh7d: dates.filter((t) => now.getTime() - t <= 7 * 864e5).length,
    newestAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    costUsd: 0,
    ...extra,
  };
}
