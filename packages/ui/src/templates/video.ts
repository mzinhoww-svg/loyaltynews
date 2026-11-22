import { motion } from "../tokens/tokens";
import {
  BRAND, C, FONT_EDITORIAL, FONT_UI, TemplateRefusal, darkBackground, esc, fitHeadline, logoGroup, logoHeight, mockChip, svgRoot, textEl, type TemplateAsset,
} from "./core";

export interface LowerThirdInput {
  /** Nome do entrevistado/executivo (obrigatório). */
  name: string;
  /** Cargo · empresa (obrigatório). */
  role: string;
  /** Conteúdo simulado: desenha o selo MOCK. */
  mock?: boolean;
}

/**
 * Lower third 1920×1080 com fundo TRANSPARENTE, geometria do template do brandkit
 * (bloco ".ln" 122×122, filete signal 8px, barra primary). Nome 40px, cargo 25px;
 * a barra cresce conforme o texto (até a margem de 96px) e recusa texto que não caberia.
 * Animação (entrada/saída 0,4 s) é do editor de vídeo: o SVG é o quadro final estático.
 */
export function renderLowerThird(input: LowerThirdInput): TemplateAsset {
  const name = input.name?.trim();
  const role = input.role?.trim();
  if (!name || !role) throw new TemplateRefusal("campo_vazio", "nome e cargo são obrigatórios");
  const W = 1920;
  const H = 1080;
  const margin = 96;
  const x0 = margin;
  const y0 = 850;
  const textX = 154;
  const maxBar = W - margin * 2; // 1728
  const nameSize = 40;
  const roleSize = 25;
  const em = 0.58;
  const need = Math.max(name.length * nameSize * em * 1.02, role.length * roleSize * em * 0.98) + textX + 48;
  const barW = Math.max(748, Math.round(need));
  if (barW > maxBar) throw new TemplateRefusal("texto_longo", `nome/cargo exigem ${barW}px; máximo ${maxBar}px dentro da margem de ${margin}px`);
  const mock = Boolean(input.mock);
  const body =
    `<g transform="translate(${x0} ${y0})" data-role="lower-third">` +
    `<rect width="${barW}" height="122" fill="${C.primary}"/>` +
    `<rect width="122" height="122" fill="${C.black}"/>` +
    `<rect x="122" width="8" height="122" fill="${C.signal}"/>` +
    textEl(21, 82, ".ln", `font-family="${esc(FONT_EDITORIAL)}" font-size="70" font-weight="bold" fill="${C.white}"`) +
    textEl(textX, 52, name, `font-family="${esc(FONT_UI)}" font-size="${nameSize}" font-weight="bold" fill="${C.white}"`) +
    textEl(textX, 89, role, `font-family="${esc(FONT_UI)}" font-size="${roleSize}" fill="${C.mint}"`) +
    `</g>` +
    (mock ? mockChip(W, margin, 1.2, "MOCK · EXEMPLO") : "");
  const alt = `Lower third: ${name}, ${role}${mock ? " — exemplo simulado" : ""}`;
  const svg = svgRoot("lower_third", W, H, alt, body, mock).replace("<svg ", `<svg data-motion-in-s="${motion.lower_third_in_s}" data-motion-out-s="${motion.lower_third_out_s}" `);
  return { kind: "lower_third", width: W, height: H, svg, alt, brandStatus: BRAND.status, brandVersion: BRAND.version, mock };
}

export interface VignetteInput {
  kind: "intro" | "outro";
  /** Linha de apoio sob a marca (ex.: título do programa). Opcional. */
  caption?: string;
  /** Texto do rodapé do outro (URL/redes). Sem padrão: o conteúdo real vem do chamador. */
  footer?: string;
  mock?: boolean;
}

/**
 * Vinheta estática 1920×1080 (quadro de intro/outro): marca reversa centralizada sobre primary,
 * filete signal e texto opcional. As durações do brandkit (intro 3,2 s / outro 3,5 s) ficam em
 * `data-motion-duration-s` para o editor de vídeo; o SVG é o quadro final.
 */
export function renderVignette(input: VignetteInput): TemplateAsset {
  const W = 1920;
  const H = 1080;
  const mock = Boolean(input.mock);
  const logoW = 760;
  const lx = (W - logoW) / 2;
  const ly = H / 2 - logoHeight(logoW) / 2 - 40;
  const parts: string[] = [darkBackground("vg", W, H, "primary")];
  parts.push(logoGroup("reverse", lx, ly, logoW));
  parts.push(`<rect x="${(W - 240) / 2}" y="${ly + logoHeight(logoW) + 56}" width="240" height="10" rx="5" fill="${C.signal}"/>`);
  const caption = input.caption?.trim();
  if (caption) {
    const { size, lines } = fitHeadline(caption, 1400, 2, 48, 28);
    lines.forEach((l, i) => parts.push(textEl(W / 2, ly + logoHeight(logoW) + 150 + i * Math.round(size * 1.2), l, `text-anchor="middle" font-family="${esc(FONT_UI)}" font-size="${size}" fill="${C.mint}"`)));
  }
  const footer = input.footer?.trim();
  if (input.kind === "outro" && footer) parts.push(textEl(W / 2, H - 110, footer, `text-anchor="middle" font-family="${esc(FONT_UI)}" font-size="34" font-weight="bold" fill="${C.signal}"`));
  if (mock) parts.push(mockChip(W, 48, 1.3));
  const dur = input.kind === "intro" ? motion.intro_s : motion.outro_s;
  const alt = `Vinheta ${input.kind === "intro" ? "de abertura" : "de encerramento"} Loyalty News${caption ? `: ${caption}` : ""}${mock ? " — exemplo simulado" : ""}`;
  const svg = svgRoot("vignette", W, H, alt, parts.join(""), mock).replace("<svg ", `<svg data-vignette="${input.kind}" data-motion-duration-s="${dur}" `);
  return { kind: "vignette", width: W, height: H, svg, alt, brandStatus: BRAND.status, brandVersion: BRAND.version, mock };
}
