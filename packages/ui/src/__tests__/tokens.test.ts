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
