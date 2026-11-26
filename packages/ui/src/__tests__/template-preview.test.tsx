// @vitest-environment jsdom
import "./setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { nomeDeArquivo, renderThumbnail, TemplatePreview } from "../index";

const ART = { title: "Cashback cresce no varejo 2026", editoria: "Varejo & Cashback", credit: "Redação Loyalty News", dateLabel: "26 nov 2026", mock: true };

function asset() {
  const a = renderThumbnail({ title: ART.title, editoria: ART.editoria, mock: true });
  return { ...a, filename: "materia-teste-thumb" };
}

function clipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("TemplatePreview", () => {
  it("snapshot do markup com a peça inline, os campos editoriais e as três ações", () => {
    const a = asset();
    const { container } = render(<TemplatePreview asset={a} copy={{ editoria: ART.editoria, title: ART.title, credit: ART.credit, dateLabel: ART.dateLabel }} caption="1280 × 720" />);
    expect(container).toMatchSnapshot();
    expect(screen.getByRole("img", { name: a.alt })).toBeTruthy();
    expect(screen.getByText(ART.editoria, { selector: ".ln-preview__eyebrow" })).toBeTruthy();
    expect(screen.getByText(ART.title, { selector: ".ln-preview__title" })).toBeTruthy();
    expect(screen.getByText(`${ART.credit} · ${ART.dateLabel}`, { selector: ".ln-preview__details" })).toBeTruthy();
  });

  it("copia o SVG inteiro para a área de transferência e anuncia no status", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    const a = asset();
    render(<TemplatePreview asset={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar SVG" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(a.svg));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("SVG copiado"));
  });

  it("falha de cópia vira mensagem honesta, sem prometer que copiou", async () => {
    clipboard(vi.fn().mockRejectedValue(new Error("sem permissão")));
    render(<TemplatePreview asset={asset()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar SVG" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Não foi possível copiar"));
  });

  it("baixa PNG: converte o SVG pelo canvas, dispara o download e avisa a tela", async () => {
    const create = vi.fn(() => "blob:previa");
    Object.defineProperty(URL, "createObjectURL", { value: create, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    class ImagemFalsa {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "";
      set src(_valor: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", ImagemFalsa);
    const ctx = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      value: (cb: (b: Blob | null) => void) => cb(new Blob(["png"], { type: "image/png" })),
      configurable: true,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const onExport = vi.fn();
    render(<TemplatePreview asset={asset()} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar PNG" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("png"));
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("PNG baixado");
  });

  it("o nome do arquivo não carrega caminho nem caractere reservado", () => {
    expect(nomeDeArquivo(" materia/../x:y ", "png")).toBe("materia-..-x-y.png");
    expect(nomeDeArquivo("   ", "svg")).toBe("peca.svg");
    expect(nomeDeArquivo("a".repeat(200), "svg").length).toBe(84);
  });
});
