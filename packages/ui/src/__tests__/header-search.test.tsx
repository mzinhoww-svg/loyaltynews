// @vitest-environment jsdom
import "./setup";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderSearch } from "../components/HeaderSearch";
import { SEARCH_DEBOUNCE_MS, useSearchSuggestions, type SearchSuggestionsResult } from "../hooks/useSearchSuggestions";

const ok = (n: number): SearchSuggestionsResult => ({
  estado: "ok",
  total: n,
  itens: Array.from({ length: n }, (_, i) => ({ href: `/noticia/m${i}`, titulo: `Matéria ${i}`, meta: "Mercado · 22 nov 2026" })),
});

describe("useSearchSuggestions (debounce, aborto, resposta atrasada, mínimo de 2 caracteres)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("com menos de 2 caracteres não chama a API (dica); com 2 chama depois de 250 ms", async () => {
    const f = vi.fn(async (_q: string) => ok(1));
    const { result, rerender } = renderHook(({ v }) => useSearchSuggestions(v, { fetchSuggestions: f, ativo: true }), { initialProps: { v: "a" } });
    expect(result.current.estado.tipo).toBe("curto");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(f).not.toHaveBeenCalled();
    rerender({ v: "ab" });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(f).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe("ab");
  });

  it("digitar rápido gera um pedido só, e o pedido anterior é ABORTADO", async () => {
    const sinais: AbortSignal[] = [];
    const f = vi.fn((_q: string, s: AbortSignal) => {
      sinais.push(s);
      return new Promise<SearchSuggestionsResult>(() => undefined);
    });
    const { rerender } = renderHook(({ v }) => useSearchSuggestions(v, { fetchSuggestions: f, ativo: true }), { initialProps: { v: "ab" } });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(f).toHaveBeenCalledTimes(1);
    rerender({ v: "abc" });
    expect(sinais[0]!.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1]![0]).toBe("abc");
  });

  it("resposta atrasada de um termo antigo nunca sobrescreve a do termo novo", async () => {
    let soltarAntiga: (r: SearchSuggestionsResult) => void = () => undefined;
    const f = vi.fn((q: string) => (q === "ab" ? new Promise<SearchSuggestionsResult>((r) => (soltarAntiga = r)) : Promise.resolve(ok(2))));
    const { result, rerender } = renderHook(({ v }) => useSearchSuggestions(v, { fetchSuggestions: f, ativo: true }), { initialProps: { v: "ab" } });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    rerender({ v: "abc" });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.estado).toMatchObject({ tipo: "itens", total: 2 });
    await act(async () => {
      soltarAntiga(ok(5));
    });
    expect(result.current.estado).toMatchObject({ tipo: "itens", total: 2 }); // continua a nova
  });

  it("limita a 5 itens; fonte indisponível vira erro (nunca vazio); sem itens é vazio; falha de rede é erro", async () => {
    const respostas: Record<string, () => Promise<SearchSuggestionsResult>> = {
      mui: async () => ok(9),
      fora: async () => ({ estado: "indisponivel", itens: [] }),
      nada: async () => ok(0),
      boom: async () => {
        throw new Error("rede");
      },
    };
    const f = vi.fn((q: string) => respostas[q]!());
    const { result, rerender } = renderHook(({ v }) => useSearchSuggestions(v, { fetchSuggestions: f, ativo: true }), { initialProps: { v: "mui" } });
    const espera = async () => {
      await act(async () => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
    };
    await espera();
    expect(result.current.estado.tipo === "itens" && result.current.estado.itens.length).toBe(5);
    rerender({ v: "fora" });
    await espera();
    expect(result.current.estado.tipo).toBe("erro");
    rerender({ v: "nada" });
    await espera();
    expect(result.current.estado.tipo).toBe("vazio");
    rerender({ v: "boom" });
    await espera();
    expect(result.current.estado.tipo).toBe("erro");
  });

  it("não busca enquanto o campo está fechado", async () => {
    const f = vi.fn(async (_q: string) => ok(1));
    renderHook(() => useSearchSuggestions("termo", { fetchSuggestions: f, ativo: false }));
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("HeaderSearch", () => {
  it("a lupa vira botão que expande o campo (sem navegar) e Esc fecha devolvendo o foco à lupa", async () => {
    const navigate = vi.fn();
    render(<HeaderSearch fetchSuggestions={async () => ok(1)} navigate={navigate} />);
    const botao = await screen.findByRole("button", { name: "Abrir busca" });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    const user = userEvent.setup();
    await user.click(botao);
    const campo = await screen.findByRole("combobox", { name: "Buscar matérias" });
    expect(campo).toHaveFocus();
    expect(navigate).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(screen.getByRole("button", { name: "Abrir busca" })).toHaveFocus();
  });

  it("Enter sem opção ativa navega para ação?q=termo", async () => {
    const navigate = vi.fn();
    render(<HeaderSearch fetchSuggestions={async () => ok(2)} navigate={navigate} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Abrir busca" }));
    await user.type(await screen.findByRole("combobox"), "bancos");
    await screen.findAllByRole("option");
    await user.keyboard("{Enter}");
    expect(navigate).toHaveBeenLastCalledWith("/busca?q=bancos");
  });

  it("HTML do servidor (sem hidratar): só o link /busca, sem campo", () => {
    const html = renderToStaticMarkup(<HeaderSearch fetchSuggestions={async () => ok(0)} />);
    expect(html).toContain('href="/busca"');
    expect(html).toContain('aria-label="Abrir busca"');
    expect(html).not.toContain("<input");
  });
});

describe("CSS do HeaderSearch (shell.css)", () => {
  const css = readFileSync(resolve(__dirname, "../styles/shell.css"), "utf8");
  const bloco = css.slice(css.indexOf("HeaderSearch: busca expansível"));
  it("só usa tokens: nenhuma cor hexadecimal ou rgb()", () => {
    expect(bloco.length).toBeGreaterThan(500);
    expect(bloco).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bloco).not.toMatch(/\brgba?\(/);
  });
  it("o campo tem 16 px (o iOS não dá zoom ao focar) e altura de var(--ln-touch-target)", () => {
    expect(bloco).toMatch(/\.ln-hsearch__input\s*\{[^}]*font-size:\s*1rem/);
    expect(bloco).toMatch(/\.ln-hsearch__input\s*\{[^}]*height:\s*var\(--ln-touch-target\)/);
  });
  it("respeita prefers-reduced-motion: reduce (sem animação)", () => {
    expect(bloco).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ln-hsearch__field\s*\{\s*animation:\s*none/);
  });
});
