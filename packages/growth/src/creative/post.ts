import type { Article, CreativeAsset } from '../types';
import { CONTEXT_SVG, LOGO_WHITE_SVG, TOKENS_JSON } from './assets.data';

// Gerador de criativo de contexto, por código, a partir do brandkit (originals/Loyalty_News_Brandkit_Assets.zip:
// templates/post_template.html, design.tokens.json, logo e ilustrações de contexto). Determinístico: mesma entrada,
// mesmo SVG. O brandkit está "approved" (design.tokens.json): o status acompanha cada criativo.

interface Tokens {
  brand_version: string;
  status: string;
  colors: { primary: string; secondary: string; mint: string; black: string; white: string; signal: string };
  typography: { ui: string; editorial: string };
  social: {
    vertical: [number, number];
    square: [number, number];
    story: [number, number];
    open_graph: [number, number];
    safe_area: number;
    headline_max_lines: number;
  };
}

export const TOKENS = TOKENS_JSON as unknown as Tokens;

export type Format = CreativeAsset['format'];
export type Theme = 'primary' | 'dark';

export class CreativeRefusal extends Error {
  readonly rule: string;
  constructor(rule: string, detail: string) {
    super(`criativo recusado (${rule}): ${detail}`);
    this.name = 'CreativeRefusal';
    this.rule = rule;
  }
}

const CONTEXT_BY_EDITORIA: Record<string, 'travel' | 'retail' | 'payments'> = {
  'Travel & Hospitality': 'travel',
  'Pontos & Milhas': 'travel',
  'Global Loyalty': 'travel',
  'Varejo & Cashback': 'retail',
  'Programas de Fidelidade': 'retail',
  'CRM & CX': 'retail',
  'Bancos & Cartões': 'payments',
  'Mercado & Negócios': 'payments',
  'LoyaltyTech & IA': 'payments',
  'Regulação & Dados': 'payments',
};

export function contextKeyFor(editoria: string): 'travel' | 'retail' | 'payments' {
  return CONTEXT_BY_EDITORIA[editoria] ?? 'payments';
}

// btoa existe no Node ≥ 16 e no navegador; o SVG é UTF-8, então passa por encodeURIComponent antes.
const b64 = (svg: string): string => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Largura média de um glifo em fonte sans bold ≈ 0.56 em (estimativa; o SVG usa fontes de sistema). */
const GLYPH_EM = 0.56;

export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/);
  const perLine = Math.max(1, Math.floor(maxWidth / (fontSize * GLYPH_EM)));
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Maior corpo de fonte (entre max e min) em que a manchete cabe em `maxLines` linhas. Se não couber, recusa. */
export function fitHeadline(text: string, maxWidth: number, maxLines: number, max: number, min: number) {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapText(text, size, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => l.length * size * GLYPH_EM <= maxWidth * 1.02)) {
      return { size, lines };
    }
  }
  throw new CreativeRefusal('manchete_longa', `"${text.slice(0, 50)}…" não cabe em ${maxLines} linhas com corpo ≥ ${min}px`);
}

export interface RenderOptions {
  format?: Format;
  theme?: Theme;
  /** Manchete do criativo; padrão = título da matéria. Nunca é encurtada com reticências. */
  headline?: string;
  /** Texto de apoio (até 2 linhas; o excedente é cortado com reticências). */
  deck?: string;
}

interface Layout {
  w: number;
  h: number;
  imgX: number;
  imgY: number;
  imgW: number;
  imgH: number;
  textX: number;
  textY: number;
  textW: number;
  headMax: number;
  headMin: number;
  logoW: number;
  wide: boolean;
}

function layoutFor(format: Format): Layout {
  const safe = TOKENS.social.safe_area;
  const pick: Record<Format, [number, number]> = {
    vertical: TOKENS.social.vertical,
    square: TOKENS.social.square,
    story: TOKENS.social.story,
    open_graph: TOKENS.social.open_graph,
    linkedin_landscape: TOKENS.social.open_graph,
  };
  const [w, h] = pick[format];
  if (format === 'open_graph' || format === 'linkedin_landscape') {
    const imgW = Math.round(w * 0.45);
    return { w, h, imgX: 0, imgY: 0, imgW, imgH: h, textX: imgW + 48, textY: 150, textW: w - imgW - 48 - 56, headMax: 44, headMin: 26, logoW: 190, wide: true };
  }
  const imgH = Math.round(h * (format === 'story' ? 0.45 : format === 'square' ? 0.5 : 0.52));
  return { w, h, imgX: 0, imgY: 0, imgW: w, imgH, textX: safe, textY: Math.round(h * (format === 'story' ? 0.5 : 0.53)), textW: w - safe * 2, headMax: format === 'story' ? 72 : 64, headMin: 40, logoW: 300, wide: false };
}

/** Renderiza o criativo em SVG (fonte da verdade) e em HTML (para pré-visualização). */
export function renderPost(article: Article, opts: RenderOptions = {}): CreativeAsset {
  const format: Format = opts.format ?? 'vertical';
  const theme: Theme = opts.theme ?? 'primary';
  const c = TOKENS.colors;
  const bg = theme === 'dark' ? c.black : c.primary;
  const L = layoutFor(format);
  const key = contextKeyFor(article.editoria);
  // O SVG de contexto é embutido com `slice` para preencher a área da imagem (sem faixas laterais).
  const context = b64(CONTEXT_SVG[key].replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" '));
  const logo = b64(LOGO_WHITE_SVG);
  const headlineText = (opts.headline ?? article.title).trim();
  if (!headlineText) throw new CreativeRefusal('sem_manchete', 'título vazio');

  const { size, lines } = fitHeadline(headlineText, L.textW, TOKENS.social.headline_max_lines, L.headMax, L.headMin);
  const lead = Math.round(size * 1.12);
  const eyebrowY = L.textY;
  const headY = eyebrowY + 54 + size;
  const deckSize = L.wide ? 20 : 30;
  const deckSource = (opts.deck ?? article.deck ?? '').trim();
  let deckLines = deckSource ? wrapText(deckSource, deckSize * 1.1, L.textW) : [];
  if (deckLines.length > 2) {
    deckLines = deckLines.slice(0, 2);
    deckLines[1] = `${(deckLines[1] ?? '').replace(/[ ,.;:]+$/, '')}…`;
  }
  const deckY = headY + (lines.length - 1) * lead + Math.round(size * 0.9) + deckSize;
  const logoH = Math.round((L.logoW * 132) / 606);
  const logoX = L.w - TOKENS.social.safe_area - L.logoW;
  const logoY = L.h - TOKENS.social.safe_area - logoH + (L.wide ? 24 : 0);
  const credit = article.mock ? 'MOCK · EXEMPLO · ILUSTRAÇÃO' : 'ILUSTRAÇÃO LOYALTY NEWS';
  const creditW = Math.round(credit.length * 12.2 + 28);
  const creditX = L.imgX + L.imgW - creditW - 24;

  const text = (x: number, y: number, s: string, extra: string) => `<text x="${x}" y="${y}" ${extra}>${esc(s)}</text>`;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}" role="img" aria-label="${esc(headlineText)}" data-brand-status="${esc(TOKENS.status)}" data-brand-version="${esc(TOKENS.brand_version)}" data-context="${key}" data-format="${format}">`);
  parts.push(`<title>${esc(headlineText)}</title>`);
  parts.push(`<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.5" stop-color="${bg}" stop-opacity="0"/><stop offset="1" stop-color="${bg}"/></linearGradient><linearGradient id="shadeX" x1="0" y1="0" x2="1" y2="0"><stop offset="0.6" stop-color="${bg}" stop-opacity="0"/><stop offset="1" stop-color="${bg}"/></linearGradient><clipPath id="img"><rect x="${L.imgX}" y="${L.imgY}" width="${L.imgW}" height="${L.imgH}"/></clipPath></defs>`);
  parts.push(`<rect width="${L.w}" height="${L.h}" fill="${bg}"/>`);
  parts.push(`<g clip-path="url(#img)"><image href="${context}" xlink:href="${context}" x="${L.imgX}" y="${L.imgY}" width="${L.imgW}" height="${L.imgH}" preserveAspectRatio="xMidYMid slice"/></g>`);
  parts.push(`<rect x="${L.imgX}" y="${L.imgY}" width="${L.imgW}" height="${L.imgH}" fill="url(#${L.wide ? 'shadeX' : 'shade'})"/>`);
  parts.push(`<rect x="${creditX}" y="24" width="${creditW}" height="34" fill="${c.black}" fill-opacity="0.75"/>`);
  parts.push(text(creditX + 14, 47, credit, `font-family="${esc(TOKENS.typography.ui)}" font-size="18" fill="${c.white}" letter-spacing="1"`));
  // eyebrow
  parts.push(`<rect x="${L.textX}" y="${eyebrowY - 22}" width="8" height="26" fill="${c.signal}"/>`);
  parts.push(text(L.textX + 22, eyebrowY, article.editoria.toUpperCase(), `font-family="${esc(TOKENS.typography.ui)}" font-size="${L.wide ? 18 : 24}" font-weight="700" fill="${c.signal}" letter-spacing="2"`));
  // headline
  lines.forEach((ln, i) => {
    parts.push(text(L.textX, headY + i * lead, ln, `font-family="${esc(TOKENS.typography.ui)}" font-size="${size}" font-weight="700" fill="${c.white}" letter-spacing="-1.5"`));
  });
  deckLines.forEach((ln, i) => {
    parts.push(text(L.textX, deckY + i * Math.round(deckSize * 1.4), ln, `font-family="${esc(TOKENS.typography.ui)}" font-size="${deckSize}" fill="${c.mint}"`));
  });
  parts.push(`<image href="${logo}" xlink:href="${logo}" x="${logoX}" y="${logoY}" width="${L.logoW}" height="${logoH}"/>`);
  if (article.mock) {
    parts.push(`<rect x="0" y="${L.h - 44}" width="${Math.round(L.w * 0.34)}" height="44" fill="#b3261e"/>`);
    parts.push(text(18, L.h - 14, 'MOCK — NÃO PUBLICAR', `font-family="${esc(TOKENS.typography.ui)}" font-size="22" font-weight="700" fill="${c.white}"`));
  }
  parts.push('</svg>');
  const svg = parts.join('');
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(headlineText)} — criativo ${format}</title><body style="margin:0;background:#e8eeeb;display:flex;justify-content:center;padding:24px"><div style="max-width:${L.w}px;width:100%">${svg}<p style="font:12px Inter,Arial,sans-serif;color:#456560">Brandkit ${esc(TOKENS.brand_version)} — status: ${esc(TOKENS.status)}${article.mock ? ' · MOCK' : ''}</p></div></body></html>`;

  return {
    format,
    width: L.w,
    height: L.h,
    svg,
    html,
    contextKey: key,
    brandStatus: TOKENS.status,
    mock: Boolean(article.mock),
  };
}
