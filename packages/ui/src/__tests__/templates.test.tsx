// @vitest-environment jsdom
import "./setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoViolations } from "./a11y";
import {
  TemplateImage,
  TemplateRefusal,
  fitHeadline,
  renderCover,
  renderLowerThird,
  renderThumbnail,
  renderVignette,
  svgToDataUri,
  wrapText,
  type TemplateAsset,
} from "../index";
import { brandColors, meta, motion, social } from "../tokens/tokens";

const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");
const assertWellFormed = (a: TemplateAsset) => {
  const doc = parse(a.svg);
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  const root = doc.documentElement;
  expect(root.getAttribute("width")).toBe(String(a.width));
  expect(root.getAttribute("height")).toBe(String(a.height));
  expect(root.getAttribute("viewBox")).toBe(`0 0 ${a.width} ${a.height}`);
  // O status de marca é o do token do brandkit (hoje "approved"); o template só o repete, nunca o afirma por conta própria.
  expect(meta.status).toBe("approved");
  expect(root.getAttribute("data-brand-status")).toBe(meta.status);
  expect(a.brandStatus).toBe(meta.status);
  return doc;
};

const ART = { title: "Cashback ganha espaço nas estratégias de retenção", editoria: "Varejo & Cashback" };

describe("texto: wrap e ajuste de manchete", () => {
  it("quebra por largura e nunca corta a manchete: recusa se não couber", () => {
    expect(wrapText("uma duas três quatro cinco", 40, 300).length).toBeGreaterThan(1);
    const ok = fitHeadline("Título curto de teste", 1000, 4, 64, 36);
    expect(ok.lines.join(" ")).toBe("Título curto de teste");
    expect(() => fitHeadline("palavra ".repeat(200), 600, 4, 64, 36)).toThrow(TemplateRefusal);
  });
});

describe("renderThumbnail", () => {
  it("1280×720, bem formado, determinístico, com alt e sem MOCK quando não é mock", () => {
    const a = renderThumbnail(ART);
    const doc = assertWellFormed(a);
    expect([a.width, a.height]).toEqual([1280, 720]);
    expect(renderThumbnail(ART).svg).toBe(a.svg);
    expect(a.alt).toContain(ART.title);
    expect(doc.querySelector('[data-role="mock"]')).toBeNull();
    expect(a.svg).toContain("VAREJO &amp; CASHBACK"); // eyebrow em maiúsculas, & escapado
    expect(a.svg).toContain(brandColors.primary);
  });
  it("mock desenha o selo MOCK visível e declara data-mock", () => {
    const a = renderThumbnail({ ...ART, mock: true });
    const doc = assertWellFormed(a);
    expect(doc.querySelector('[data-role="mock"]')?.textContent).toContain("MOCK");
    expect(a.mock).toBe(true);
    expect(a.alt).toMatch(/simulado/);
  });
  it("escapa caracteres de marcação no título (sem injeção de SVG)", () => {
    const a = renderThumbnail({ title: 'A <script>alert(1)</script> & "aspas"', editoria: "CRM & CX" });
    const doc = assertWellFormed(a);
    expect(doc.getElementsByTagName("script")).toHaveLength(0);
    expect(a.svg).toContain("&lt;script&gt;");
  });
  it("manchete em no máximo headline_max_lines linhas", () => {
    const a = renderThumbnail({ title: "Uma manchete bastante longa que precisa quebrar em várias linhas para caber no formato", editoria: "Global Loyalty" });
    const doc = assertWellFormed(a);
    const heads = [...doc.querySelectorAll("text")].filter((t) => t.getAttribute("font-weight") === "700" && Number(t.getAttribute("font-size")) >= 36);
    expect(heads.length).toBeLessThanOrEqual(social.headline_max_lines);
  });
  it("geometria: o texto fica abaixo da faixa superior e acima do logo, mesmo com a manchete mais longa aceita", () => {
    const longest = "palavra ".repeat(22).trim(); // chega a 4 linhas perto do corpo mínimo
    const doc = assertWellFormed(renderThumbnail({ title: longest, editoria: "Regulação & Dados" }));
    const heads = [...doc.querySelectorAll("text")].filter((t) => t.getAttribute("font-weight") === "700" && Number(t.getAttribute("font-size")) >= 36);
    expect(heads.length).toBeGreaterThan(0);
    const ys = heads.map((t) => Number(t.getAttribute("y")));
    expect(Math.min(...ys)).toBeGreaterThan(250); // abaixo da faixa mint (250px)
    const logoTop = 720 - 72 - Math.round((230 * 132) / 606) + 12;
    expect(Math.max(...ys)).toBeLessThan(logoTop);
  });
  it("recusa campos vazios e manchete que não cabe", () => {
    expect(() => renderThumbnail({ title: " ", editoria: "CRM & CX" })).toThrow(/campo_vazio/);
    expect(() => renderThumbnail({ title: "x", editoria: "" })).toThrow(/campo_vazio/);
    expect(() => renderThumbnail({ title: "palavra ".repeat(120), editoria: "CRM & CX" })).toThrow(/texto_longo/);
  });
  it("usa ilustração fornecida (data URI) sem inventar imagem", () => {
    const a = renderThumbnail({ ...ART, illustration: "data:image/svg+xml;base64,PHN2Zy8+" });
    expect(assertWellFormed(a).querySelector("image")).not.toBeNull();
    expect(assertWellFormed(renderThumbnail(ART)).querySelector("image")).toBeNull();
  });
});

describe("renderCover", () => {
  it("1920×1080 com eyebrow, manchete, apoio e data; apoio longo é limitado a 3 linhas", () => {
    const a = renderCover({ ...ART, deck: "Uma leitura sobre os diferentes modelos de incentivo. ".repeat(8), dateLabel: "22 de novembro de 2026" });
    const doc = assertWellFormed(a);
    expect([a.width, a.height]).toEqual([1920, 1080]);
    expect(a.svg).toContain("22 de novembro de 2026");
    const deck = [...doc.querySelectorAll("text")].filter((t) => t.getAttribute("font-size") === "36");
    expect(deck.length).toBeLessThanOrEqual(3);
    expect(deck.at(-1)?.textContent?.endsWith("…")).toBe(true);
  });
  it("mock mostra selo; sem mock não", () => {
    expect(assertWellFormed(renderCover({ ...ART, mock: true })).querySelector('[data-role="mock"]')).not.toBeNull();
    expect(assertWellFormed(renderCover(ART)).querySelector('[data-role="mock"]')).toBeNull();
  });
});

describe("renderLowerThird (geometria do template do brandkit)", () => {
  it("replica o lower_third_1920x1080.svg: posição, blocos, filete e tipografia", () => {
    const a = renderLowerThird({ name: "Nome do executivo", role: "Cargo · Empresa" });
    const doc = assertWellFormed(a);
    expect([a.width, a.height]).toEqual([1920, 1080]);
    const g = doc.querySelector('[data-role="lower-third"]')!;
    expect(g.getAttribute("transform")).toBe("translate(96 850)");
    const rects = [...g.querySelectorAll("rect")].map((r) => [r.getAttribute("x"), r.getAttribute("width"), r.getAttribute("height"), r.getAttribute("fill")]);
    expect(rects).toEqual([
      [null, "748", "122", brandColors.primary],
      [null, "122", "122", brandColors.black],
      ["122", "8", "122", brandColors.signal],
    ]);
    const texts = [...g.querySelectorAll("text")].map((t) => [t.textContent, t.getAttribute("x"), t.getAttribute("y"), t.getAttribute("font-size"), t.getAttribute("fill")]);
    expect(texts).toEqual([
      [".ln", "21", "82", "70", brandColors.white],
      ["Nome do executivo", "154", "52", "40", brandColors.white],
      ["Cargo · Empresa", "154", "89", "25", brandColors.mint],
    ]);
  });
  it("fundo transparente (sem retângulo de tela cheia) e durações de movimento do brandkit", () => {
    const a = renderLowerThird({ name: "A", role: "B" });
    const doc = assertWellFormed(a);
    expect([...doc.querySelectorAll("rect")].some((r) => r.getAttribute("width") === "1920")).toBe(false);
    expect(doc.documentElement.getAttribute("data-motion-in-s")).toBe(String(motion.lower_third_in_s));
    expect(doc.documentElement.getAttribute("data-motion-out-s")).toBe(String(motion.lower_third_out_s));
  });
  it("barra cresce com texto longo e recusa o que passa da margem", () => {
    const long = renderLowerThird({ name: "Nome Muito Comprido de Executivo da Empresa", role: "Diretora de Programas de Fidelidade e Relacionamento · Empresa Exemplo" });
    const w = Number(assertWellFormed(long).querySelector('[data-role="lower-third"] rect')!.getAttribute("width"));
    expect(w).toBeGreaterThan(748);
    expect(w).toBeLessThanOrEqual(1728);
    expect(() => renderLowerThird({ name: "x".repeat(200), role: "y" })).toThrow(/texto_longo/);
    expect(() => renderLowerThird({ name: "", role: "y" })).toThrow(/campo_vazio/);
  });
  it("mock desenha selo MOCK e escapa o texto", () => {
    const a = renderLowerThird({ name: "Fulano & <Cia>", role: "Cargo", mock: true });
    const doc = assertWellFormed(a);
    expect(doc.querySelector('[data-role="mock"]')?.textContent).toContain("MOCK");
    expect(a.svg).toContain("Fulano &amp; &lt;Cia&gt;");
  });
});

describe("renderVignette", () => {
  it("intro 1920×1080 com durações do brandkit (3,2 s) e logo reverso", () => {
    const a = renderVignette({ kind: "intro" });
    const doc = assertWellFormed(a);
    expect(doc.documentElement.getAttribute("data-motion-duration-s")).toBe(String(motion.intro_s));
    expect(doc.querySelectorAll("path")).toHaveLength(12);
    expect(a.svg).toContain(brandColors.signal);
  });
  it("outro (3,5 s) mostra rodapé só se informado; nada inventado", () => {
    const sem = renderVignette({ kind: "outro" });
    expect(parse(sem.svg).documentElement.textContent).toBe(""); // nenhum texto inventado (URL, rede, slogan)
    expect(parse(sem.svg).documentElement.getAttribute("data-motion-duration-s")).toBe(String(motion.outro_s));
    const com = renderVignette({ kind: "outro", footer: "Rodapé de teste", caption: "Programa de teste" });
    expect(com.svg).toContain("Rodapé de teste");
    expect(com.svg).toContain("Programa de teste");
  });
  it("intro ignora footer; mock desenha selo", () => {
    const a = renderVignette({ kind: "intro", footer: "não deve aparecer", mock: true });
    expect(a.svg).not.toContain("não deve aparecer");
    expect(assertWellFormed(a).querySelector('[data-role="mock"]')).not.toBeNull();
  });
});

describe("TemplateImage", () => {
  it("renderiza <img> com data URI, alt do template e dimensões; passa no axe", async () => {
    const asset = renderThumbnail({ ...ART, mock: true });
    const { container } = render(<TemplateImage asset={asset} width={320} />);
    const img = screen.getByRole("img", { name: asset.alt });
    expect(img.getAttribute("src")).toBe(svgToDataUri(asset.svg));
    expect(img).toHaveAttribute("width", "1280");
    expect(img).toHaveAttribute("data-mock", "true");
    await expectNoViolations(container);
  });
  it("decorative usa alt vazio", () => {
    const { container } = render(<TemplateImage asset={renderVignette({ kind: "intro" })} decorative />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});
