import { brandColors, meta, social, typography } from "../tokens/tokens";
import { logoData, monogramData } from "../components/logo-data";
import type { LogoVariant } from "../components/Logo";

/**
 * Núcleo dos templates visuais por código (brandkit 2.0-draft.1, "proposal_not_approved").
 * Funções puras: mesma entrada → mesmo SVG, sem acesso a arquivos nem DOM.
 * Os formatos sociais (feed/story/OG/LinkedIn) pertencem a `packages/growth`; aqui ficam
 * thumbnail, capa, lower third e vinheta (portal, Studio e vídeo).
 */

export interface TemplateAsset {
  kind: "thumbnail" | "cover" | "lower_third" | "vignette";
  width: number;
  height: number;
  /** SVG completo (fonte da verdade). */
  svg: string;
  /** Texto alternativo sugerido para <img alt>. */
  alt: string;
  brandStatus: string;
  brandVersion: string;
  /** Conteúdo simulado: o criativo traz selo MOCK desenhado. */
  mock: boolean;
}

export class TemplateRefusal extends Error {
  readonly rule: string;
  constructor(rule: string, detail: string) {
    super(`template recusado (${rule}): ${detail}`);
    this.name = "TemplateRefusal";
    this.rule = rule;
  }
}

export const C = brandColors;
export const SAFE = social.safe_area;
export const MAX_HEADLINE_LINES = social.headline_max_lines;
export const FONT_UI = typography.ui;
export const FONT_EDITORIAL = typography.editorial;
export const BRAND = { status: meta.status, version: meta.brandVersion };

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Largura média de glifo (em) para fontes de sistema em negrito: estimativa conservadora. */
const GLYPH_EM = 0.58;

export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const perLine = Math.max(1, Math.floor(maxWidth / (fontSize * GLYPH_EM)));
  const lines: string[] = [];
  let cur = "";
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

/** Maior corpo (entre max e min) em que a manchete cabe em `maxLines`. Se não couber, RECUSA (nunca corta com "…"). */
export function fitHeadline(text: string, maxWidth: number, maxLines: number, max: number, min: number): { size: number; lines: string[] } {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapText(text, size, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => l.length * size * GLYPH_EM <= maxWidth * 1.02)) return { size, lines };
  }
  throw new TemplateRefusal("texto_longo", `"${text.slice(0, 50)}…" não cabe em ${maxLines} linhas com corpo ≥ ${min}px`);
}

/** Corta em `maxLines` linhas com reticências (para texto de apoio, nunca para manchete). */
export function clampLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  out[maxLines - 1] = `${(out[maxLines - 1] ?? "").replace(/[ ,.;:]+$/, "")}…`;
  return out;
}

/** Logo oficial como <g> posicionado: largura alvo em px (proporção 606×132). */
export function logoGroup(variant: LogoVariant, x: number, y: number, width: number): string {
  const [w] = logoData.size;
  const s = width / w;
  const fills = logoData.fills[variant];
  const paths = logoData.paths.map((p, i) => `<path fill="${fills[i]}" d="${p.d}" transform="${p.transform}"/>`).join("");
  return `<g transform="translate(${x} ${y}) scale(${s.toFixed(5)})">${paths}</g>`;
}

export const logoHeight = (width: number): number => Math.round((width * logoData.size[1]) / logoData.size[0]);

/** Monograma oficial (".ln") como <g>. */
export function monogramGroup(variant: "dark" | "light", x: number, y: number, size: number, opacity = 1): string {
  const [w] = monogramData.size;
  const s = size / w;
  const parts = (monogramData[variant] as readonly Record<string, string | undefined>[])
    .map((el) =>
      el.tag === "rect"
        ? `<rect x="${el.x ?? 0}" y="${el.y ?? 0}" width="${el.width}" height="${el.height}"${el.rx ? ` rx="${el.rx}"` : ""} fill="${el.fill}"/>`
        : `<path fill="${el.fill}" d="${el.d}" transform="${el.transform}"/>`,
    )
    .join("");
  return `<g transform="translate(${x} ${y}) scale(${s.toFixed(5)})" opacity="${opacity}">${parts}</g>`;
}

export function svgRoot(kind: TemplateAsset["kind"], w: number, h: number, label: string, body: string, mock: boolean): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" ` +
    `data-template="${kind}" data-brand-status="${esc(BRAND.status)}" data-brand-version="${esc(BRAND.version)}" data-mock="${mock}">` +
    body +
    `</svg>`
  );
}

/** Selo MOCK desenhado (regra do fast-track: mock sempre visível). Canto superior direito. */
export function mockChip(w: number, margin: number, scale = 1, text = "MOCK · EXEMPLO"): string {
  const fs = Math.round(22 * scale);
  const cw = Math.round(text.length * fs * 0.66 + 28 * scale);
  const ch = Math.round(40 * scale);
  const x = w - margin - cw;
  return (
    `<g data-role="mock"><rect x="${x}" y="${margin}" width="${cw}" height="${ch}" fill="${C.black}"/>` +
    `<text x="${x + cw / 2}" y="${margin + ch / 2 + fs * 0.35}" text-anchor="middle" font-family="${esc(FONT_UI)}" font-size="${fs}" font-weight="700" fill="${C.white}">${esc(text)}</text></g>`
  );
}

/** Eyebrow: barrinha + rótulo em maiúsculas na cor signal (padrão do post_template do brandkit). */
export function eyebrow(x: number, y: number, label: string, size: number): string {
  return (
    `<rect x="${x}" y="${y - size * 0.8}" width="${Math.max(4, Math.round(size * 0.14))}" height="${Math.round(size * 0.8)}" fill="${C.signal}"/>` +
    `<text x="${x + size * 0.5}" y="${y}" font-family="${esc(FONT_UI)}" font-size="${size}" font-weight="700" letter-spacing="${(size * 0.04).toFixed(1)}" fill="${C.signal}">${esc(label.toUpperCase())}</text>`
  );
}

/** Fundo escuro padrão: degradê vertical primary → black (como o post_example do brandkit). */
export function darkBackground(id: string, w: number, h: number, theme: "primary" | "dark"): string {
  const top = theme === "dark" ? C.black : C.primary;
  const bottom = theme === "dark" ? C.black : C.primary;
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${id})"/>`
  );
}

export const textEl = (x: number, y: number, s: string, attrs: string): string => `<text x="${x}" y="${y}" ${attrs}>${esc(s)}</text>`;

/** SVG → data URI (para <img src>). */
export const svgToDataUri = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
