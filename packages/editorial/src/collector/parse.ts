import { stripHtml } from './sanitize';

export interface FeedItem { title: string; link: string; publishedAt: string | null; summary: string }

function tag(block: string, name: string): string | null {
  // (?=[\s>]) em vez de \b: "<article-card>" e "<main-menu>" não são <article>/<main>
  const m = new RegExp(`<${name}(?=[\\s>])[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return null;
  return m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

function isoOrNull(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** RSS 2.0 e Atom, sem dependências. Link do item = <link>, href do Atom ou <guid> permalink http(s); itens sem endereço são descartados. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    let link = tag(b, 'link');
    if (!link || !/^https?:/i.test(link)) {
      const m = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(b);
      link = m ? m[1]! : null;
    }
    // RSS sem <link>: o endereço da matéria vem no <guid> (ex.: Agência Senado). Só vale se for http(s) e não marcado isPermaLink="false".
    if (!link) {
      const g = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(b);
      const val = g ? g[2]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim() : '';
      if (g && !/isPermaLink=["']false["']/i.test(g[1]!) && /^https?:\/\//i.test(val)) link = val;
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

export interface HtmlMeta { title: string; canonical: string | null; publishedAt: string | null; bodyHtml: string; /** links http(s) absolutos do corpo escolhido (até 25, sem repetição) */ links: string[] }

/** Blocos que nunca são conteúdo da matéria (menus, rodapé, avisos, formulários, mídia embutida). */
const CHROME = /<(script|style|noscript|template|svg|iframe|nav|header|footer|aside|form|dialog|button|select)\b[\s\S]*?<\/\1>/gi;

/**
 * Texto da matéria por PARÁGRAFOS: <p>, <h2>, <h3>, <blockquote> fora de menus/rodapé/avisos, sem repetição.
 * Serve de alternativa quando a página não tem <article>/<main> utilizável (ex.: Agência Senado), onde o primeiro bloco
 * achado era um aviso de notificações em vez da matéria.
 */
/** id/class de parágrafos que são avisos da página, não matéria. */
const NOT_CONTENT_ATTR = /\b(?:id|class)\s*=\s*["'][^"']*(?:modal|cookie|consent|popup|newsletter|banner|notif)/i;

export function paragraphsHtml(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(CHROME, ' ');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of clean.matchAll(/<(p|h2|h3|blockquote)(?=[\s>])([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    if (NOT_CONTENT_ATTR.test(m[2]!)) continue; // parágrafo de aviso (modal, cookies, newsletter...) pelo id/class
    const text = stripHtml(m[3]!).replace(/\s+/g, ' ').trim();
    const min = m[1]!.toLowerCase() === 'p' ? 40 : 20;
    if (text.length < min || seen.has(text)) continue;
    seen.add(text);
    out.push(`<p>${text.replace(/</g, '&lt;')}</p>`);
  }
  return out.join('\n');
}

const MIN_BLOCK = 400;
const textLen = (h: string) => stripHtml(h).replace(/\s+/g, ' ').trim().length;

/** Links http(s) do trecho (resolvidos contra a base). Só o corpo da matéria: menus e rodapé ficam de fora quando há <article>/<main>. */
export function linksIn(html: string, base?: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a(?=[\s>])[^>]*?\shref=["']([^"'#][^"']*)["']/gi)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, '&'), base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.toString());
    } catch { /* ignora href inválido */ }
    if (out.size >= 25) break;
  }
  return [...out];
}

export function parseHtml(html: string, base?: string): HtmlMeta {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const t = tag(html, 'title');
  const h1 = tag(html, 'h1');
  const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  const pub = /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1]
    ?? /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  const main = tag(html, 'article') ?? tag(html, 'main');
  const block = main ?? tag(html, 'body') ?? html;
  // Sem <article>/<main> (o <body> inteiro traz avisos, menus e rodapé) ou com bloco curto (< 400 caracteres): usa os
  // parágrafos da página quando eles trazem mais conteúdo.
  let bodyHtml = block;
  if (main === null || textLen(block) < MIN_BLOCK) {
    const paras = paragraphsHtml(html);
    if (main === null ? textLen(paras) >= MIN_BLOCK / 2 || textLen(paras) > textLen(block) : textLen(paras) > textLen(block)) bodyHtml = paras;
  }
  return { title: stripHtml(og ?? h1 ?? t ?? ''), canonical, publishedAt: isoOrNull(pub), bodyHtml, links: linksIn(main ?? block, base) };
}

export interface SitemapEntry { loc: string; lastmod: string | null }
/**
 * Entradas do sitemap que NÃO viraram URL, por motivo (nunca são requisitadas): bloco sem <loc>; <loc> que não começa com http(s);
 * <loc> com URL absoluta EMBUTIDA no caminho (ex.: "http://www.gov.br/anachttps://www.gov.br/anac/…", defeito do espelho http do gov.br).
 */
export interface SitemapDrops { total: number; sem_loc: number; loc_nao_http: number; loc_url_embutida: number; amostra: string[] }
/**
 * sitemap.xml: <urlset> (páginas) ou <sitemapindex> (outros sitemaps). Sem dependências; não aproveita entrada sem http(s) (fail closed),
 * mas CONTA o que descartou e por quê (`drops`), para um sitemap malformado não virar "0 matérias" em silêncio. `blocos` = <url>/<sitemap> lidos.
 */
export function parseSitemap(xml: string): { kind: 'urlset' | 'index'; entries: SitemapEntry[]; blocos: number; drops: SitemapDrops } {
  const kind = /<sitemapindex(?=[\s>])/i.test(xml) ? 'index' : 'urlset';
  const entries: SitemapEntry[] = [];
  const drops: SitemapDrops = { total: 0, sem_loc: 0, loc_nao_http: 0, loc_url_embutida: 0, amostra: [] };
  const amostrar = (loc: string) => { if (drops.amostra.length < 3) drops.amostra.push(loc.replace(/\p{Cc}/gu, '?').slice(0, 100)); };
  let blocos = 0;
  for (const m of xml.matchAll(/<(url|sitemap)(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/gi)) {
    blocos++;
    const loc = tag(m[2]!, 'loc')?.replace(/&amp;/g, '&').trim();
    if (!loc) { drops.sem_loc++; drops.total++; continue; }
    if (!/^https?:\/\//i.test(loc)) {
      drops.loc_nao_http++; drops.total++; amostrar(loc);
      continue;
    }
    // URL absoluta dentro do caminho (antes de ? e #): endereço quebrado, não existe como página; descartar e contar.
    if (/^https?:\/\/[^?#]*https?:\/\//i.test(loc)) { drops.loc_url_embutida++; drops.total++; amostrar(loc); continue; }
    entries.push({ loc, lastmod: isoOrNull(tag(m[2]!, 'lastmod')) });
  }
  return { kind, entries, blocos, drops };
}
