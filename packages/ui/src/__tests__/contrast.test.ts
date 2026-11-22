import { describe, expect, it } from "vitest";
import { colors } from "../tokens/tokens";

/** Contraste WCAG 2.x (luminância relativa sRGB). */
function lum(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type C = keyof typeof colors;
const c = (k: C) => colors[k];

// Pares texto/fundo realmente usados em src/styles/*.css (AA texto normal = 4,5:1).
const TEXT_PAIRS: Array<[string, C, C]> = [
  ["corpo: black sobre white", "black", "white"],
  ["corpo: black sobre mint", "black", "mint"],
  ["link/titulos: primary sobre white", "primary", "white"],
  ["badge editoria: primary sobre mint", "primary", "mint"],
  ["badge editoria hover: primary sobre signal", "primary", "signal"],
  ["texto secundário: text-muted sobre white", "text-muted", "white"],
  ["texto secundário: text-muted sobre mint", "text-muted", "mint"],
  ["acento texto: secondary-strong sobre white", "secondary-strong", "white"],
  ["acento texto: secondary-strong sobre mint", "secondary-strong", "mint"],
  ["botão primário: white sobre primary", "white", "primary"],
  ["botão primário hover: white sobre black", "white", "black"],
  ["botão acento: white sobre secondary-strong", "white", "secondary-strong"],
  ["header/footer: white sobre primary", "white", "primary"],
  ["header/footer: signal sobre primary", "signal", "primary"],
  ["MockBadge: warning-fg sobre warning-bg", "warning-fg", "warning-bg"],
  ["erro de formulário: danger sobre white", "danger", "white"],
];

// Elementos gráficos/bordas de componentes (WCAG 1.4.11 = 3:1).
const UI_PAIRS: Array<[string, C, C]> = [
  ["borda de campo: border-strong sobre white", "border-strong", "white"],
  ["foco: focus sobre white", "focus", "white"],
  ["foco: focus sobre mint", "focus", "mint"],
  ["foco em superfície escura: signal sobre primary", "signal", "primary"],
  ["marca/gráfico: secondary sobre white", "secondary", "white"],
  ["borda de campo: border-strong sobre mint", "border-strong", "mint"],
];

describe("contraste WCAG 2.x AA — texto (>= 4,5:1)", () => {
  it.each(TEXT_PAIRS)("%s", (_n, fg, bg) => {
    expect(ratio(c(fg), c(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contraste WCAG 2.x AA — componentes de UI e gráficos (>= 3:1)", () => {
  it.each(UI_PAIRS)("%s", (_n, fg, bg) => {
    expect(ratio(c(fg), c(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe("achado do brandkit: secondary cru não serve para texto pequeno", () => {
  it("secondary (#34877A) sobre white fica entre 3:1 e 4,5:1 → só para gráficos/texto grande", () => {
    const r = ratio(c("secondary"), c("white"));
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThan(4.5);
  });
  it("texto branco sobre secondary cru também falha AA normal; usar secondary-strong", () => {
    expect(ratio(c("white"), c("secondary"))).toBeLessThan(4.5);
    expect(ratio(c("white"), c("secondary-strong"))).toBeGreaterThanOrEqual(4.5);
  });
});
