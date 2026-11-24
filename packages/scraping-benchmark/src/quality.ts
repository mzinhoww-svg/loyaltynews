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
  const lp = detectWall({ text: body, html, httpStatus });
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

/**
 * Evidência de texto editorial sem guardar o texto (parecer QA 3, M2): o começo da página costuma ser navegação, então o trecho
 * vem do MAIOR parágrafo (tags <p> no HTML; linhas no texto/markdown). Devolve só métricas e um trecho ≤ 200 (DP-29).
 */
export interface BodyEvidence {
  longestParagraphChars: number;
  longParagraphs: number; // parágrafos com ≥ 200 caracteres
  excerpt?: string; // ≤ 200, do início do maior parágrafo
}
export function bodyEvidence(text: string | undefined, html: string | undefined): BodyEvidence {
  const clean = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  let paras: string[] = [];
  if (html && /<p[\s>]/i.test(html)) paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1] ?? ''));
  if (!paras.length && (text ?? html)) {
    const src = text ?? html!;
    // R3 (QA 1): parágrafo = bloco entre linhas em branco, com as linhas do bloco juntadas (hard wrap); sem linha em branco, por linha
    const blocks = /\n\s*\n/.test(src) ? src.split(/\n\s*\n/) : src.split(/\n/);
    paras = blocks.map((b) => b.split(/\n/).map((l) => clean(l).replace(/^[#>*\-\s]+/, '').trim()).filter(Boolean).join(' ').trim());
  }
  paras = paras.filter((p) => p.length > 0 && !/^(\[.*\]\(.*\)\s*)+$/.test(p)); // descarta linhas só de links (menus em markdown)
  if (!paras.length) return { longestParagraphChars: 0, longParagraphs: 0 };
  const longest = paras.reduce((a, b) => (b.length > a.length ? b : a));
  return { longestParagraphChars: longest.length, longParagraphs: paras.filter((p) => p.length >= 200).length, excerpt: longest.slice(0, SNIPPET_MAX) };
}

/**
 * Guarda de login/paywall com limite de tamanho (ressalva R2 do QA 1, 63c16df). O detector do Data testa o aviso de paywall no
 * texto inteiro: uma reportagem longa que CITE "assine para continuar lendo" seria descartada. Aqui:
 *  - página curta (≤ 3.000 caracteres): checagem completa, como antes (paywall/login costumam ser páginas curtas);
 *  - página longa: só os primeiros 1.500 caracteres, sem o teste de formulário de senha (rodapé de "área do cliente").
 * 401/402 da origem continuam valendo sempre.
 */
export const WALL_SHORT_PAGE = 3000;
export const WALL_HEAD_CHARS = 1500;
export const WALL_ELEMENT_CHARS = 6000;
export function detectWall(r: { text?: string; html?: string; httpStatus?: number }): 'login_required' | 'paywall' | null {
  const text = r.text ?? '';
  if (r.httpStatus === 401 || r.httpStatus === 402 || text.length <= WALL_SHORT_PAGE) return detectLoginOrPaywall(r);
  const head = detectLoginOrPaywall({ text: text.slice(0, WALL_HEAD_CHARS), httpStatus: r.httpStatus });
  if (head) return head;
  // R4 (QA 3, 542ec10): aviso que só existe em overlay/modal no HTML. Checa (a) o início do texto visível do HTML e
  // (b) o texto de elementos cujo class/id indica paywall/overlay/modal, em qualquer ponto da página.
  if (r.html) {
    const visible = r.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (detectLoginOrPaywall({ text: visible.slice(0, WALL_HEAD_CHARS) }) === 'paywall') return 'paywall';
    for (const m of r.html.matchAll(WALL_ELEMENT)) {
      if (!isWallMarker(m[2] ?? '')) continue;
      // elemento de overlay é curto por natureza: lê até 6.000 caracteres dele (antes 1.500), lacuna registrada pelo QA 3
      const inner = (m[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WALL_ELEMENT_CHARS);
      const hit = detectLoginOrPaywall({ text: inner });
      if (hit === 'paywall') return 'paywall';
    }
  }
  return null;
}
/** Elemento de overlay/paywall/modal (class ou id), com o conteúdo até o fechamento da mesma tag. */
const WALL_ELEMENT = /<(div|section|aside|dialog)[^>]*?(?:class|id)=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;

/**
 * Marcador por TOKEN de class/id (ressalva R5 do QA 3, ee01f58): divide em espaço, hífen e underscore.
 *  - fortes (bastam sozinhos): paywall, regwall, subscri*, assinant*, premium, overlay, modal, piano, meter, tp;
 *  - fracos (gate, wall): só com um qualificador no mesmo atributo (content, pay, reg, member, login, article, story, premium,
 *    subscriber, assinante) — assim "content-gate" e "pay-wall" contam, mas "gateway", "firewall", "aggregate" e um
 *    wrapper "wall" isolado do corpo não.
 */
const STRONG = new Set(['paywall', 'regwall', 'premium', 'overlay', 'modal', 'piano', 'meter', 'tp']);
const STRONG_PREFIX = ['subscri', 'assinant'];
const WEAK = new Set(['gate', 'wall']);
const QUALIFIER = new Set(['content', 'pay', 'reg', 'member', 'members', 'login', 'article', 'story', 'premium', 'subscriber', 'assinante']);
export function isWallMarker(attr: string): boolean {
  const toks = attr.toLowerCase().split(/[\s\-_]+/).filter(Boolean);
  if (toks.some((t) => STRONG.has(t) || STRONG_PREFIX.some((p) => t.startsWith(p)))) return true;
  return toks.some((t) => WEAK.has(t)) && toks.some((t) => QUALIFIER.has(t));
}
