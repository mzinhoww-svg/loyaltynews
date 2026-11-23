/**
 * Critérios editoriais únicos para todos os provedores (Diretiva V3 §9): HTTP 200 com conteúdo inválido NÃO é sucesso.
 * Extrai metadados do HTML/texto efêmero e devolve só o que pode ser persistido (hash, tamanho, trecho ≤ 200).
 */
import { createHash } from 'node:crypto';
import { detectLoginOrPaywall } from '@ln/intelligence';

export const MIN_EDITORIAL_CHARS = 600;
export const SNIPPET_MAX = 200;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function meta(html: string, keys: string[]): string | undefined {
  for (const k of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${k}["']`, 'i');
    const m = html.match(re1) ?? html.match(re2);
    if (m?.[1]) return decode(m[1]);
  }
  return undefined;
}

function jsonLd(html: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i');
  for (const block of html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const m = block.match(re);
    if (m?.[1]) return decode(m[1]);
  }
  return undefined;
}

export interface ExtractedMeta {
  title?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
  siteName?: string;
}

export function extractMeta(html: string | undefined, text: string | undefined): ExtractedMeta {
  const out: ExtractedMeta = {};
  if (html) {
    out.title =
      meta(html, ['og:title', 'twitter:title']) ??
      jsonLd(html, 'headline') ??
      (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ? decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)![1] ?? '').replace(/<[^>]+>/g, '')) : undefined) ??
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1] ?? '') : undefined);
    out.author = meta(html, ['author', 'article:author', 'parsely-author']) ?? jsonLd(html, 'name');
    out.publishedAt =
      meta(html, ['article:published_time', 'datePublished', 'parsely-pub-date', 'pubdate', 'date', 'DC.date.issued']) ??
      jsonLd(html, 'datePublished') ??
      html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
    out.language = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? meta(html, ['og:locale', 'language']);
    out.siteName = meta(html, ['og:site_name', 'application-name']);
  } else if (text) {
    const first = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l.length > 10);
    if (first) out.title = first.slice(0, 300);
  }
  return out;
}

/** Similaridade de títulos por tokens (Jaccard sobre palavras normalizadas de ≥ 3 letras). */
export function titleSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const tok = (s: string) =>
    new Set(
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    );
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  // o título da página costuma ter sufixo " | Portal": mede contra o menor conjunto
  return inter / Math.min(A.size, B.size);
}

/** Mesma data de calendário (UTC±1 dia de tolerância por fuso). null = não verificável. */
export function sameDate(found?: string, reference?: string | null): boolean | null {
  if (!found || !reference) return null;
  const a = Date.parse(found);
  const b = Date.parse(reference);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(a - b) <= 36 * 3600 * 1000;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function snippetOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX);
}

const CAPTCHA_RE = /(cf-chl|challenge-platform|captcha|are you a robot|verify you are human|access denied|attention required)/i;

export interface EditorialVerdict {
  editorialSuccess: boolean;
  reason: 'ok' | 'empty_content' | 'captcha' | 'login_required' | 'paywall' | 'title_mismatch';
  meta: ExtractedMeta;
  textLength: number;
  titleMatch: number;
  contentHash?: string;
  snippet?: string;
}

export function evaluate(text: string | undefined, html: string | undefined, referenceTitle: string, httpStatus?: number): EditorialVerdict {
  const body = (text ?? '').trim();
  const m = extractMeta(html, body);
  // título só pelos metadados/H1 (ressalva QA 3, M2: o atalho pelo corpo aceitava divergências); sem metadados, 1ª linha do texto
  const tm = titleSimilarity(m.title, referenceTitle);
  const base = { meta: m, textLength: body.length, titleMatch: tm, contentHash: body ? sha256(body) : undefined, snippet: body ? snippetOf(body) : undefined };
  const lp = detectLoginOrPaywall({ text: body, html, httpStatus });
  if (lp) return { ...base, editorialSuccess: false, reason: lp };
  if (body.length < MIN_EDITORIAL_CHARS) {
    if (CAPTCHA_RE.test(body) || CAPTCHA_RE.test(html?.slice(0, 5000) ?? '')) return { ...base, editorialSuccess: false, reason: 'captcha' };
    return { ...base, editorialSuccess: false, reason: 'empty_content' };
  }
  if (tm < 0.5) return { ...base, editorialSuccess: false, reason: 'title_mismatch' };
  return { ...base, editorialSuccess: true, reason: 'ok' };
}

/**
 * Critério v2 (estrito) reaplicado a um registro JÁ GRAVADO (parecer QA 3, reavaliação M2): título recalculado só a partir do
 * título extraído e gravado (sem o atalho pelo corpo), contra o título de referência. O corpo integral não é guardado, então
 * a presença/qualidade do texto continua aproximada pelo tamanho e pela classe de erro original. Estimativa: o título gravado
 * pode estar truncado (≤ 300 caracteres).
 */
export function rejudgeRecord<T extends { technicalSuccess: boolean; editorialSuccess: boolean; textLength: number; title?: string; titleMatch?: number; errorClass: string }>(r: T, referenceTitle: string): T & { criterion: 'v2' } {
  const tm = titleSimilarity(r.title, referenceTitle);
  const blocked = ['login_required', 'paywall', 'captcha'].includes(r.errorClass);
  const ok = r.technicalSuccess && !blocked && r.textLength >= MIN_EDITORIAL_CHARS && tm >= 0.5;
  const errorClass = ok ? 'none' : blocked || !r.technicalSuccess ? r.errorClass : r.textLength < MIN_EDITORIAL_CHARS ? (r.errorClass === 'captcha' ? 'captcha' : 'empty_content') : 'title_mismatch';
  return { ...r, titleMatch: +tm.toFixed(3), editorialSuccess: ok, errorClass, criterion: 'v2' };
}
