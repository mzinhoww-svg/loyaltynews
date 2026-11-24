import { useEffect, useRef, useState } from "react";

/** Uma sugestão pronta para exibir (o app converte a resposta da sua API para isto). */
export interface SearchSuggestion {
  href: string;
  titulo: string;
  /** Linha de apoio (ex.: "Mercado & Negócios · 22 nov 2026"). */
  meta?: string;
}

export type SearchSuggestionsResult =
  | { estado: "ok"; itens: SearchSuggestion[]; total?: number }
  | { estado: "indisponivel"; itens: [] };

export type SearchSuggestionsState =
  | { tipo: "inicial" }
  | { tipo: "curto" }
  | { tipo: "buscando" }
  | { tipo: "itens"; itens: SearchSuggestion[]; total: number }
  | { tipo: "vazio" }
  | { tipo: "erro" };

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 80; // decisão do PM: 2 a 80 caracteres
export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_MAX_ITEMS = 5;

export interface UseSearchSuggestionsOptions {
  fetchSuggestions: (q: string, signal: AbortSignal) => Promise<SearchSuggestionsResult>;
  /** Só busca enquanto `ativo` (campo aberto). */
  ativo: boolean;
  debounceMs?: number;
  minChars?: number;
}

/**
 * Sugestões da busca: debounce de 250 ms, mínimo de 2 caracteres, até 5 itens; uma nova digitação ABORTA o pedido anterior e uma resposta
 * atrasada nunca sobrescreve uma mais nova (id de pedido crescente). Sem cache entre termos e sem registrar o termo em lugar nenhum.
 */
export function useSearchSuggestions(valor: string, { fetchSuggestions, ativo, debounceMs = SEARCH_DEBOUNCE_MS, minChars = SEARCH_MIN_CHARS }: UseSearchSuggestionsOptions): {
  termo: string;
  estado: SearchSuggestionsState;
} {
  const termo = valor.trim().slice(0, SEARCH_MAX_CHARS);
  const [estado, setEstado] = useState<SearchSuggestionsState>({ tipo: "inicial" });
  const pedido = useRef(0);
  const fetchRef = useRef(fetchSuggestions);
  fetchRef.current = fetchSuggestions;

  useEffect(() => {
    if (!ativo) return;
    pedido.current += 1;
    const id = pedido.current;
    if (termo.length === 0) {
      setEstado({ tipo: "inicial" });
      return;
    }
    if (termo.length < minChars) {
      setEstado({ tipo: "curto" });
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setEstado({ tipo: "buscando" });
      try {
        const r = await fetchRef.current(termo, ctrl.signal);
        if (id !== pedido.current || ctrl.signal.aborted) return; // resposta atrasada: descarta
        if (r.estado === "indisponivel") setEstado({ tipo: "erro" });
        else if (r.itens.length) setEstado({ tipo: "itens", itens: r.itens.slice(0, SEARCH_MAX_ITEMS), total: r.total ?? r.itens.length });
        else setEstado({ tipo: "vazio" });
      } catch (e) {
        if (id !== pedido.current || ctrl.signal.aborted || (e as { name?: string }).name === "AbortError") return;
        setEstado({ tipo: "erro" });
      }
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [ativo, termo, debounceMs, minChars]);

  return { termo, estado };
}
