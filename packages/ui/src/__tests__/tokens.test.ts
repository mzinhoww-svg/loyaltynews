import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brandColors, colors, typography, social, motion, meta, spacing, radius, breakpoints } from "../tokens/tokens";
import { EDITORIAS } from "../editorias";

const root = resolve(__dirname, "../..");
const brand = JSON.parse(readFileSync(resolve(root, "tokens/design.tokens.json"), "utf8"));
const css = readFileSync(resolve(root, "src/tokens/tokens.css"), "utf8");

describe("tokens gerados a partir do design.tokens.json do brandkit", () => {
  it("cores da marca idênticas ao brandkit", () => {
    expect(brandColors).toEqual(brand.colors);
    expect(brandColors.primary).toBe("#153C3C");
    expect(brandColors.secondary).toBe("#34877A");
  });
  it("tipografia, social e motion idênticos ao brandkit", () => {
    expect(typography).toEqual(brand.typography);
    expect(social).toEqual(brand.social);
    expect(motion).toEqual(brand.motion);
  });
  it("preserva o status do brandkit (proposta, não aprovado)", () => {
    expect(meta.status).toBe("proposal_not_approved");
    expect(meta.brandVersion).toBe("2.0-draft.1");
  });
  it("cada cor vira CSS variable --ln-color-*", () => {
    for (const [k, v] of Object.entries(colors)) {
      expect(css).toContain(`--ln-color-${k}: ${v};`);
    }
  });
  it("define espaçamentos, raios e fontes como CSS variables", () => {
    for (const k of Object.keys(spacing)) expect(css).toContain(`--ln-space-${k}:`);
    for (const k of Object.keys(radius)) expect(css).toContain(`--ln-radius-${k}:`);
    expect(css).toContain("--ln-font-ui: Inter, Arial, sans-serif;");
    expect(css).toContain("--ln-font-editorial: Georgia, Noto Serif, serif;");
  });
  it("breakpoints batem com os usados no CSS (768/1024)", () => {
    expect(breakpoints.md).toBe("768px");
    expect(breakpoints.lg).toBe("1024px");
  });
});

describe("editorias", () => {
  it("são exatamente as 10 do Blueprint v2.1, na ordem", () => {
    expect(EDITORIAS.map((e) => e.nome)).toEqual([
      "Mercado & Negócios",
      "Programas de Fidelidade",
      "Pontos & Milhas",
      "Bancos & Cartões",
      "Varejo & Cashback",
      "Travel & Hospitality",
      "LoyaltyTech & IA",
      "CRM & CX",
      "Global Loyalty",
      "Regulação & Dados",
    ]);
  });
  it("slugs únicos e URL-safe", () => {
    const slugs = EDITORIAS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(10);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("tipografia aplicada (Brandkit 2.0: Inter em UI, manchetes e dados; Georgia só na assinatura editorial)", () => {
  const base = readFileSync(resolve(root, "src/styles/base.css"), "utf8");
  const studio = readFileSync(resolve(root, "src/styles/studio.css"), "utf8");
  it("h1–h4 usam a fonte de UI (Inter), não a editorial", () => {
    const rule = base.match(/\.ln-root h1,[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("font-family: var(--ln-font-ui)");
    expect(rule).not.toContain("--ln-font-editorial");
  });
  it("valores de KPI (dados) usam Inter", () => {
    const rule = studio.match(/\.ln-kpi__value \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("var(--ln-font-ui)");
  });
});

describe("regras visuais P2 dos cards e do toque (V-07, V-08, V-11)", () => {
  const content = readFileSync(resolve(root, "src/styles/content.css"), "utf8");
  it("V-07: miniatura sm em 16:9 (3:2 cortava as laterais da arte)", () => {
    expect(content).toMatch(/\.ln-card--sm \.ln-card__media \{ aspect-ratio: 16 \/ 9; \}/);
    expect(content).not.toMatch(/\.ln-card--sm \.ln-card__media \{ aspect-ratio: 3 \/ 2; \}/);
  });
  it("V-08: selos do card ficam numa linha só (sem wrap) e o MOCK não encolhe", () => {
    expect(content).toMatch(/\.ln-card__meta \{ flex-wrap: nowrap; \}/);
    expect(content).toMatch(/\.ln-card \.ln-mock-badge \{ flex: none; white-space: nowrap;/);
  });
  it("D-6: o rótulo da ilustração na miniatura sm tem no mínimo 10px (0.625rem), piso recomendado pelo QA 8", () => {
    const m = content.match(/\.ln-card--sm \.ln-card__imglabel \{[^}]*font-size: ([0-9.]+)rem/);
    expect(m, "regra do rótulo na miniatura sm").not.toBeNull();
    expect(Number(m![1]) * 16).toBeGreaterThanOrEqual(10);
  });
  it("V-11: tags de editoria (celular) e breadcrumb e botão do cabeçalho (até o tablet) usam o token de alvo de toque", () => {
    expect(content).toMatch(/max-width: 767px\) \{ \.ln-root a\.ln-tag--link \{ min-height: var\(--ln-touch-target\)/);
    const controls = readFileSync(resolve(root, "src/styles/controls.css"), "utf8");
    const shell = readFileSync(resolve(root, "src/styles/shell.css"), "utf8");
    // Parecer do Senior Auditor (D-5): o breadcrumb e o botão do cabeçalho também têm 44px no tablet (até 1023px), não só no celular.
    expect(controls).toMatch(/max-width: 1023px\) \{ \.ln-breadcrumb__item a \{ min-height: var\(--ln-touch-target\)/);
    expect(shell).toMatch(/max-width: 1023px\) \{ \.ln-header__actions \.ln-btn, \.ln-header \.ln-header__cta \{ min-height: var\(--ln-touch-target\)/);
  });
});
