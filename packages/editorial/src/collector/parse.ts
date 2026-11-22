import { stripHtml } from './sanitize';

export interface FeedItem { title: string; link: string; publishedAt: string | null; summary: string }

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return null;
  return m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

function isoOrNull(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** RSS 2.0 e Atom, sem dependências. Itens sem link são descartados. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    let link = tag(b, 'link');
    if (!link || !/^https?:/i.test(link)) {
      const m = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(b);
      link = m ? m[1]! : null;
    }
    if (!link) continue;
    const title = stripHtml(tag(b, 'title') ?? '');
    const summary = stripHtml(tag(b, 'description') ?? tag(b, 'summary') ?? '');
    items.push({
      title, link: link.trim(), summary,
      publishedAt: isoOrNull(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date')),
    });
  }
  return items;
}

export interface HtmlMeta { title: string; canonical: string | null; publishedAt: string | null; bodyHtml: string }

export function parseHtml(html: string): HtmlMeta {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const t = tag(html, 'title');
  const h1 = tag(html, 'h1');
  const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  const pub = /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1]
    ?? /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  const main = tag(html, 'article') ?? tag(html, 'main') ?? tag(html, 'body') ?? html;
  return { title: stripHtml(og ?? h1 ?? t ?? ''), canonical, publishedAt: isoOrNull(pub), bodyHtml: main };
}
