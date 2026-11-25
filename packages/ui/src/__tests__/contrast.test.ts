import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  ["StatusPill/Toast neutro", "neutral-fg", "neutral-bg"],
  ["StatusPill/Toast info", "info-fg", "info-bg"],
  ["StatusPill/Toast sucesso", "success-fg", "success-bg"],
  ["StatusPill/Toast alerta", "warning-fg", "warning-bg"],
  ["StatusPill/Toast erro", "danger-fg", "danger-bg"],
  ["KPI variação positiva sobre white", "success-fg", "white"],
  ["KPI variação negativa sobre white", "danger-fg", "white"],
  ["cabeçalho de tabela: primary sobre surface-subtle", "primary", "surface-subtle"],
  ["texto secundário sobre surface-subtle", "text-muted", "surface-subtle"],
  ["corpo sobre surface-subtle", "black", "surface-subtle"],
  ["contador da sidebar: primary sobre signal", "primary", "signal"],
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

// Tabela medida em 25/11/2026: as quatro categorias pedidas, com o número fechado.
// Se o token mudar, o número muda e o teste falha — é o registro, não uma estimativa.
const ROOT = resolve(__dirname, "../..");
const BASE_CSS = readFileSync(resolve(ROOT, "src/styles/base.css"), "utf8");
const CONTROLS_CSS = readFileSync(resolve(ROOT, "src/styles/controls.css"), "utf8");
const CONTENT_CSS = readFileSync(resolve(ROOT, "src/styles/content.css"), "utf8");

describe("tabela medida — corpo, link, botão primário e texto sobre imagem", () => {
  const CATEGORIAS: Array<[string, C, C, number]> = [
    ["corpo", "black", "white", 17.43],
    ["link", "primary", "white", 12.04],
    ["botão primário", "white", "primary", 12.04],
    ["texto sobre imagem (rótulo em chip sólido)", "white", "black", 17.43],
  ];

  it.each(CATEGORIAS)("%s: %s sobre %s = %s:1", (_n, fg, bg, esperado) => {
    expect(ratio(c(fg), c(bg))).toBeCloseTo(esperado, 1);
    expect(ratio(c(fg), c(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("as regras que produzem os quatro pares continuam as mesmas", () => {
    expect(BASE_CSS).toContain("color: var(--ln-role-fg);");
    expect(BASE_CSS).toContain("background: var(--ln-role-bg);");
    expect(BASE_CSS).toMatch(/\.ln-root a \{ color: var\(--ln-role-link\); \}/);
    expect(CONTROLS_CSS).toMatch(/\.ln-btn--primary[^{]*\{[^}]*background: var\(--ln-color-primary\)[^}]*color: var\(--ln-color-white\)/);
    expect(CONTENT_CSS).toMatch(/\.ln-card__imglabel \{[\s\S]*?color: var\(--ln-color-white\);[\s\S]*?background: var\(--ln-color-black\);/);
  });

  it("texto sobre imagem é opaco: o rótulo usa chip sólido, nunca texto direto na foto", () => {
    const regra = CONTENT_CSS.match(/\.ln-card__imglabel \{[^}]*\}/)?.[0] ?? "";
    expect(regra).toContain("background: var(--ln-color-black)");
    expect(regra).not.toContain("transparent");
  });

  it("nenhum par de texto da lista fica abaixo de 4,5:1", () => {
    const abaixo = TEXT_PAIRS.map(([n, fg, bg]) => [n, ratio(c(fg), c(bg))] as const).filter(([, r]) => r < 4.5);
    expect(abaixo).toEqual([]);
  });
});

// Achados aprovados pelo PM em 25/11/2026: os dois casos fora do portal entram travados aqui.
const GROWTH_UI = readFileSync(resolve(ROOT, "../growth/src/ui/components.ts"), "utf8");
const PORTAL_CSS = readFileSync(resolve(ROOT, "../../apps/web/app/(portal)/portal.css"), "utf8");
const TOKENS_CSS = readFileSync(resolve(ROOT, "src/tokens/tokens.css"), "utf8");

/** Valor que o navegador aplica: lido do próprio tokens.css, não do mapa TS. */
const cssVar = (name: string): string => {
  const m = TOKENS_CSS.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ausente em tokens.css: ${name}`);
  return m[1] as string;
};

describe("achados aprovados: acento da prévia e borda do chip", () => {
  it("hashtag e link da prévia: a cor resolvida passa de 4,5:1 no branco, na menta e na surface", () => {
    const decl = GROWTH_UI.match(/const ACENTO_TEXTO = "([^"]+)"/)?.[1] ?? "";
    const varDaDecl = decl.match(/var\((--ln-color-[a-z-]+)\)/)?.[1] ?? "";
    const hexDoConstante = varDaDecl ? cssVar(varDaDecl) : /^#[0-9a-f]{6}$/i.test(decl) ? decl : "";

    const linhas = GROWTH_UI.split("\n");
    const usos = [
      linhas.find((l) => l.includes("s.type === 'hashtag'")) ?? "",
      linhas.find((l) => l.includes("s.type === 'link'")) ?? "",
    ];
    for (const linha of usos) {
      // A linha pode usar a constante (caso atual) ou voltar ao literal do brandkit (regressão).
      const hex = linha.includes("ACENTO_TEXTO") ? hexDoConstante : /C\.secondary\b/.test(linha) ? "#34877A" : "";
      expect(hex).not.toBe("");
      for (const bg of ["white", "mint", "surface-subtle"] as const) {
        expect(ratio(hex, c(bg))).toBeGreaterThanOrEqual(4.5);
      }
      expect(linha).not.toMatch(/C\.secondary\b/);
    }
  });

  it("borda do .pt-chip: o valor resolvido do token usado na regra passa de 3:1", () => {
    const regra = PORTAL_CSS.match(/\.pt-chip \{[^}]*\}/)?.[0] ?? "";
    const token = regra.match(/border: 1px solid var\((--ln-color-[a-z-]+)\)/)?.[1] ?? "";
    expect(token).not.toBe(""); // a regra tem de usar token, não hex fixo
    const hex = cssVar(token);
    expect(ratio(hex, c("white"))).toBeGreaterThanOrEqual(3);
  });

  it("a borda do .pt-chip não usa o token fraco", () => {
    const regra = PORTAL_CSS.match(/\.pt-chip \{[^}]*\}/)?.[0] ?? "";
    expect(regra).not.toMatch(/var\(--ln-color-border\)/);
  });

  it("a cor da prévia vem do token, sem um segundo valor em código", () => {
    expect(GROWTH_UI).toMatch(/const ACENTO_TEXTO = "var\(--ln-color-secondary-strong\)"/);
    expect(GROWTH_UI).not.toMatch(/#2A6F65/);
  });
});
