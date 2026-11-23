import { createHash } from 'node:crypto';

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|igshid|_hs)/i;

/** URL canônica: host minúsculo, sem fragmento, sem parâmetros de rastreio, query ordenada, sem barra final. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function normalizeText(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }
export function contentHash(text: string): string { return sha256(normalizeText(text)); }

export function shingles(text: string, k = 3): Set<string> {
  const w = normalizeText(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (w.length < k) { if (w.length) out.add(w.join(' ')); return out; }
  for (let i = 0; i <= w.length - k; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DedupeItem { id: string; url: string; title: string; text: string }
export type DedupeReason = 'same_url' | 'same_hash' | 'similar';
export interface DedupeMatch { id: string; of: string; reason: DedupeReason; similarity: number }

export const DEFAULT_SIMILARITY = 0.6;

/**
 * Deduplicação determinística em ordem de chegada: URL canônica → hash do texto normalizado → similaridade lexical
 * (Jaccard de shingles de 3 palavras). O primeiro item é o representante do cluster.
 */
export class Deduper {
  private readonly urls = new Map<string, string>();
  private readonly hashes = new Map<string, string>();
  private readonly sh: Array<{ id: string; s: Set<string> }> = [];
  private readonly threshold: number;
  constructor(threshold = DEFAULT_SIMILARITY) { this.threshold = threshold; }

  check(item: DedupeItem): DedupeMatch | null {
    const cu = canonicalUrl(item.url);
    const u = this.urls.get(cu);
    if (u) return { id: item.id, of: u, reason: 'same_url', similarity: 1 };
    const h = contentHash(`${item.title}\n${item.text}`);
    const hh = this.hashes.get(h);
    if (hh) return { id: item.id, of: hh, reason: 'same_hash', similarity: 1 };
    const s = shingles(`${item.title} ${item.text}`);
    let best: { id: string; sim: number } | null = null;
    for (const o of this.sh) {
      const sim = jaccard(s, o.s);
      if (sim >= this.threshold && (!best || sim > best.sim)) best = { id: o.id, sim };
    }
    if (best) return { id: item.id, of: best.id, reason: 'similar', similarity: best.sim };
    return null;
  }

  /** Verifica e, se for novo, registra. */
  add(item: DedupeItem): DedupeMatch | null {
    const m = this.check(item);
    if (m) return m;
    this.urls.set(canonicalUrl(item.url), item.id);
    this.hashes.set(contentHash(`${item.title}\n${item.text}`), item.id);
    this.sh.push({ id: item.id, s: shingles(`${item.title} ${item.text}`) });
    return null;
  }
}

export function clusterItems(items: DedupeItem[], threshold = DEFAULT_SIMILARITY): { clusters: Map<string, string[]>; matches: DedupeMatch[] } {
  const d = new Deduper(threshold);
  const clusters = new Map<string, string[]>();
  const matches: DedupeMatch[] = [];
  for (const it of items) {
    const m = d.add(it);
    if (m) { matches.push(m); clusters.get(m.of)?.push(it.id); }
    else clusters.set(it.id, [it.id]);
  }
  return { clusters, matches };
}
