import {
  BRAND, C, FONT_UI, MAX_HEADLINE_LINES, SAFE, TemplateRefusal, clampLines, darkBackground, esc, eyebrow, fitHeadline, logoGroup, logoHeight,
  mockChip, monogramGroup, svgRoot, textEl, wrapText, type TemplateAsset,
} from "./core";

export interface ArticleTemplateInput {
  title: string;
  /** Nome da editoria (ex.: "Pontos & Milhas"). Aparece como eyebrow. */
  editoria: string;
  /** Texto de apoio (só na capa). */
  deck?: string;
  /** Data já formatada (só na capa). */
  dateLabel?: string;
  theme?: "primary" | "dark";
  /** Conteúdo simulado: desenha o selo MOCK. */
  mock?: boolean;
  /** Ilustração opcional (data URI de imagem) para a área superior; ex.: contexto do brandkit fornecido pelo Growth. */
  illustration?: string;
}

const need = (v: string, what: string) => {
  if (!v || !v.trim()) throw new TemplateRefusal("campo_vazio", `${what} é obrigatório`);
};

/**
 * Thumbnail de matéria 1280×720 (16:9; cartões do portal, listas do Studio).
 * Layout: ilustração/monograma na metade superior, eyebrow + manchete (≤ 4 linhas) na inferior, logo à direita.
 */
export function renderThumbnail(input: ArticleTemplateInput): TemplateAsset {
  need(input.title, "título");
  need(input.editoria, "editoria");
  const W = 1280;
  const H = 720;
  const theme = input.theme ?? "primary";
  const mock = Boolean(input.mock);
  const textW = W - SAFE * 2;
  const { size, lines } = fitHeadline(input.title.trim(), textW, MAX_HEADLINE_LINES, 64, 36);
  const lead = Math.round(size * 1.12);
  const eyebrowSize = 26;
  const headTop = 330;
  const logoW = 230;
  const parts: string[] = [darkBackground("tg", W, H, theme)];
  // metade superior: ilustração ou marca d'água do monograma
  if (input.illustration) {
    parts.push(`<image href="${esc(input.illustration)}" x="0" y="0" width="${W}" height="${headTop - 40}" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    parts.push(monogramGroup("light", W - 420, -70, 520, 0.12));
  }
  parts.push(eyebrow(SAFE, headTop, input.editoria, eyebrowSize));
  lines.forEach((l, i) => parts.push(textEl(SAFE, headTop + 36 + size + i * lead, l, `font-family="${esc(FONT_UI)}" font-size="${size}" font-weight="700" fill="${C.white}"`)));
  parts.push(logoGroup("reverse", W - SAFE - logoW, H - SAFE - logoHeight(logoW) + 12, logoW));
  if (mock) parts.push(mockChip(W, 28));
  const alt = `Thumbnail: ${input.title.trim()} (${input.editoria})${mock ? " — exemplo simulado" : ""}`;
  return { kind: "thumbnail", width: W, height: H, svg: svgRoot("thumbnail", W, H, alt, parts.join(""), mock), alt, brandStatus: BRAND.status, brandVersion: BRAND.version, mock };
}

/**
 * Capa de matéria/edição 1920×1080: coluna de texto à esquerda (eyebrow, manchete, apoio, data)
 * e painel mint com o monograma à direita.
 */
export function renderCover(input: ArticleTemplateInput): TemplateAsset {
  need(input.title, "título");
  need(input.editoria, "editoria");
  const W = 1920;
  const H = 1080;
  const theme = input.theme ?? "primary";
  const mock = Boolean(input.mock);
  const panelW = 640;
  const textX = 120;
  const textW = W - panelW - textX - 100;
  const { size, lines } = fitHeadline(input.title.trim(), textW, MAX_HEADLINE_LINES, 92, 52);
  const lead = Math.round(size * 1.12);
  const top = 250;
  const parts: string[] = [darkBackground("cg", W, H, theme)];
  // painel direito
  parts.push(`<rect x="${W - panelW}" y="0" width="${panelW}" height="${H}" fill="${C.mint}"/>`);
  if (input.illustration) {
    parts.push(`<image href="${esc(input.illustration)}" x="${W - panelW}" y="0" width="${panelW}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    parts.push(monogramGroup("dark", W - panelW + (panelW - 360) / 2, (H - 360) / 2 - 40, 360));
    parts.push(`<rect x="${W - panelW + (panelW - 360) / 2 + 36}" y="${(H - 360) / 2 + 340}" width="240" height="10" rx="5" fill="${C.signal}"/>`);
  }
  parts.push(eyebrow(textX, top, input.editoria, 34));
  lines.forEach((l, i) => parts.push(textEl(textX, top + 56 + size + i * lead, l, `font-family="${esc(FONT_UI)}" font-size="${size}" font-weight="700" fill="${C.white}"`)));
  let y = top + 56 + size + (lines.length - 1) * lead + 70;
  const deck = input.deck?.trim();
  if (deck) {
    const deckLines = clampLines(wrapText(deck, 36 * 1.1, textW), 3);
    deckLines.forEach((l, i) => parts.push(textEl(textX, y + i * 48, l, `font-family="${esc(FONT_UI)}" font-size="36" fill="${C.mint}"`)));
    y += deckLines.length * 48;
  }
  if (input.dateLabel?.trim()) parts.push(textEl(textX, H - 150, input.dateLabel.trim(), `font-family="${esc(FONT_UI)}" font-size="28" fill="${C.signal}"`));
  parts.push(logoGroup("reverse", textX, H - SAFE - logoHeight(300) + 8, 300));
  if (mock) parts.push(mockChip(W, 40, 1.3));
  const alt = `Capa: ${input.title.trim()} (${input.editoria})${mock ? " — exemplo simulado" : ""}`;
  return { kind: "cover", width: W, height: H, svg: svgRoot("cover", W, H, alt, parts.join(""), mock), alt, brandStatus: BRAND.status, brandVersion: BRAND.version, mock };
}

