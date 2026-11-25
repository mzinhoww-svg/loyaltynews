"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SEARCH_MAX_CHARS, SEARCH_MIN_CHARS, useSearchSuggestions, type SearchSuggestionsResult } from "../hooks/useSearchSuggestions";
import { cx, type LinkAs } from "../utils";

export type { SearchSuggestion, SearchSuggestionsResult } from "../hooks/useSearchSuggestions";

export interface HeaderSearchProps {
  /** Busca as sugestões para o termo (já aparado, de 2 a 100 caracteres). Deve respeitar `signal`. */
  fetchSuggestions: (q: string, signal: AbortSignal) => Promise<SearchSuggestionsResult>;
  /** Navegação do app (ex.: `router.push`). Sem ela usa `window.location`. */
  navigate?: (href: string) => void;
  linkAs?: LinkAs;
  /** Página de resultados (GET ?q=). */
  action?: string;
  /** Muda quando a página muda: fecha o campo e limpa o termo. */
  routeKey?: string;
  /** Termo atual quando a página é a de resultados: o campo abre preenchido. */
  getInitialQuery?: () => string | undefined;
  className?: string;
}

const Lupa = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16.2 16.2L20 20" />
  </svg>
);
const X = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** Título com o trecho que casou com o termo em negrito (sem acento é igual: compara em minúsculas). */
function destacar(titulo: string, termo: string): ReactNode {
  const i = termo ? titulo.toLowerCase().indexOf(termo.toLowerCase()) : -1;
  if (i < 0) return titulo;
  return (
    <>
      {titulo.slice(0, i)}
      <b>{titulo.slice(i, i + termo.length)}</b>
      {titulo.slice(i + termo.length)}
    </>
  );
}

/**
 * Busca do cabeçalho: a lupa EXPANDE um campo no próprio cabeçalho (sem navegar), com sugestões em lista suspensa.
 * Padrão combobox (aria-expanded, aria-controls, aria-activedescendant; setas, Home/End, Enter, Esc). Sem JavaScript, ou antes de hidratar, a lupa é
 * um link para a página de resultados (`action`), que tem o formulário GET. Abaixo de 1024 px o campo cobre a barra inteira (com "Cancelar");
 * no desktop expande à esquerda da lupa e o menu fica oculto enquanto aberto.
 */
export function HeaderSearch({ fetchSuggestions, navigate, linkAs, action = "/busca", routeKey, getInitialQuery, className }: HeaderSearchProps) {
  const Link = linkAs ?? "a";
  const base = useId().replace(/:/g, "");
  const campoId = `${base}-campo`;
  const listaId = `${base}-lista`;
  const opcaoId = (i: number) => `${base}-op-${i}`;

  const [hidratado, setHidratado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [ativo, setAtivo] = useState(-1);
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const devolverFoco = useRef(false);

  useEffect(() => setHidratado(true), []);

  const { termo, estado } = useSearchSuggestions(valor, { fetchSuggestions, ativo: aberto });
  const hrefResultados = `${action}?q=${encodeURIComponent(termo)}`;
  const itens = estado.tipo === "itens" ? estado.itens : [];
  const comTodos = estado.tipo === "itens" || estado.tipo === "vazio" || estado.tipo === "erro";
  const opcoes = comTodos ? [...itens.map((s) => ({ href: s.href, item: s as (typeof itens)[number] | null })), { href: hrefResultados, item: null }] : [];
  const painelVisivel = estado.tipo !== "inicial" && termo.length > 0;

  const fechar = useCallback((devolver: boolean) => {
    devolverFoco.current = devolver;
    setAberto(false);
    setAtivo(-1);
  }, []);

  // O botão da lupa fica oculto enquanto aberto: o foco só volta a ele depois de fechar e renderizar.
  useEffect(() => {
    if (!aberto && devolverFoco.current) {
      devolverFoco.current = false;
      botao.current?.focus();
    }
  }, [aberto]);

  // Trocou de página: fecha tudo e limpa o termo.
  useEffect(() => {
    setAberto(false);
    setAtivo(-1);
    setValor("");
  }, [routeKey]);

  // Abriu: foco automático; na página de resultados o termo atual volta preenchido.
  useEffect(() => {
    if (!aberto) return;
    const q = getInitialQuery?.();
    if (q) setValor(q.slice(0, SEARCH_MAX_CHARS));
    campo.current?.focus();
    // só ao abrir
  }, [aberto]);

  // Clique fora fecha (o foco NÃO volta à lupa: a pessoa clicou em outro lugar).
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: Event) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) fechar(false);
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto, fechar]);

  // Aberto: o que fica coberto não recebe foco (inert). Abaixo de 1024 px o campo cobre a barra e a página; no desktop só o menu fica oculto.
  useEffect(() => {
    if (!aberto || !raiz.current) return;
    const header = raiz.current.closest("header");
    header?.setAttribute("data-search-open", "true");
    const estreito = window.matchMedia?.("(max-width: 1023px)")?.matches ?? false;
    const alvos: Element[] = [];
    const add = (el: Element | null | undefined) => el && alvos.push(el);
    add(header?.querySelector(".ln-header__main"));
    if (estreito) {
      add(header?.querySelector(".ln-header__brand"));
      add(header?.querySelector(".ln-header__cta"));
      add(header?.querySelector(".ln-header__toggle"));
      add(header?.querySelector(".ln-header__panel"));
      add(document.querySelector("main"));
      add(document.querySelector("footer"));
      for (const irmao of Array.from(raiz.current.parentElement?.children ?? [])) if (irmao !== raiz.current) alvos.push(irmao);
    }
    const antes = alvos.map((el) => (el as HTMLElement & { inert?: boolean }).inert ?? false);
    for (const el of alvos) (el as HTMLElement & { inert?: boolean }).inert = true;
    return () => {
      header?.removeAttribute("data-search-open");
      alvos.forEach((el, i) => {
        (el as HTMLElement & { inert?: boolean }).inert = antes[i]!;
      });
    };
  }, [aberto]);

  // Saiu do componente pelo teclado (Tab): fecha, sem devolver o foco.
  const aoSairDoFoco = (e: React.FocusEvent) => {
    if (aberto && raiz.current && !raiz.current.contains(e.relatedTarget as Node | null) && e.relatedTarget !== null) fechar(false);
  };

  const ir = (href: string) => {
    fechar(false);
    if (navigate) navigate(href);
    else window.location.assign(href);
  };

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      fechar(true);
    } else if (e.key === "ArrowDown" && opcoes.length) {
      e.preventDefault();
      setAtivo((a) => (a + 1) % opcoes.length);
    } else if (e.key === "ArrowUp" && opcoes.length) {
      e.preventDefault();
      setAtivo((a) => (a <= 0 ? opcoes.length - 1 : a - 1));
    } else if (e.key === "Home" && opcoes.length && ativo >= 0) {
      e.preventDefault();
      setAtivo(0);
    } else if (e.key === "End" && opcoes.length && ativo >= 0) {
      e.preventDefault();
      setAtivo(opcoes.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (ativo >= 0 && opcoes[ativo]) ir(opcoes[ativo]!.href);
      else if (termo) ir(hrefResultados);
    }
  };

  const anuncio =
    estado.tipo === "buscando"
      ? "Buscando…"
      : estado.tipo === "itens"
        ? `${itens.length} sugest${itens.length === 1 ? "ão" : "ões"}. Use as setas para navegar.`
        : estado.tipo === "vazio"
          ? `Nada encontrado para “${termo}”.`
          : estado.tipo === "erro"
            ? "Não conseguimos buscar agora."
            : "";

  // Sem JavaScript, ou antes de hidratar: a lupa é um link para a página de resultados.
  if (!hidratado) {
    return (
      <div className={cx("ln-hsearch", className)}>
        <Link href={action} className="ln-icon-link ln-hsearch__btn" aria-label="Abrir busca">
          <Lupa />
        </Link>
      </div>
    );
  }

  return (
    <div className={cx("ln-hsearch", className)} data-open={aberto ? "true" : "false"} ref={raiz} onBlur={aoSairDoFoco}>
      <button ref={botao} type="button" className="ln-icon-link ln-hsearch__btn" aria-label="Abrir busca" aria-expanded={aberto} aria-controls={`${base}-campo-form`} onClick={() => setAberto(true)}>
        <Lupa />
      </button>
      {aberto && (
        <form
          id={`${base}-campo-form`}
          role="search"
          aria-label="Buscar no portal"
          action={action}
          method="get"
          className="ln-hsearch__field"
          onSubmit={(e) => {
            e.preventDefault();
            if (termo) ir(hrefResultados);
          }}
        >
          <span className="ln-hsearch__icon" aria-hidden="true">
            <Lupa />
          </span>
          <input
            ref={campo}
            id={campoId}
            type="search"
            name="q"
            className="ln-hsearch__input"
            role="combobox"
            aria-label="Buscar matérias"
            aria-autocomplete="list"
            aria-expanded={opcoes.length > 0}
            aria-controls={listaId}
            aria-activedescendant={ativo >= 0 ? opcaoId(ativo) : undefined}
            placeholder="Buscar matérias"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={SEARCH_MAX_CHARS}
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              setAtivo(-1);
            }}
            onKeyDown={aoTeclar}
          />
          {valor && (
            <button
              type="button"
              className="ln-hsearch__clear"
              aria-label="Limpar busca"
              onClick={() => {
                setValor("");
                setAtivo(-1);
                campo.current?.focus();
              }}
            >
              <X />
            </button>
          )}
          <button type="button" className="ln-hsearch__cancel" onClick={() => fechar(true)}>
            Cancelar
          </button>
          {painelVisivel && (
            <div className="ln-hsearch__panel" aria-busy={estado.tipo === "buscando" ? "true" : undefined}>
              {estado.tipo === "curto" && <p className="ln-hsearch__msg">Digite pelo menos {SEARCH_MIN_CHARS} caracteres.</p>}
              {estado.tipo === "buscando" && (
                <>
                  <p className="ln-hsearch__msg" data-testid="busca-carregando">
                    Buscando…
                  </p>
                  <div className="ln-hsearch__skel" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                </>
              )}
              {estado.tipo === "vazio" && (
                <p className="ln-hsearch__msg" data-testid="busca-vazio">
                  <strong>Nada encontrado para “{termo}”.</strong> A busca procura no título e no resumo das matérias publicadas. Tente outro termo.
                </p>
              )}
              {estado.tipo === "erro" && (
                <p className="ln-hsearch__msg" data-testid="busca-erro">
                  <strong>Não conseguimos buscar agora.</strong> Isso não significa que não haja resultados.
                </p>
              )}
              {opcoes.length > 0 && (
                <ul id={listaId} role="listbox" aria-label="Sugestões" className="ln-hsearch__list" data-testid="busca-sugestoes">
                  {opcoes.map((o, i) => (
                    <li key={`${o.href}-${i}`} role="presentation">
                      {/* O link É a opção (role=option no <a>): um link dentro de <li role=option> reprova no axe (nested-interactive). */}
                      <Link
                        href={o.href}
                        id={opcaoId(i)}
                        role="option"
                        aria-selected={ativo === i}
                        tabIndex={-1}
                        className={cx("ln-hsearch__opt", o.item === null && "ln-hsearch__opt--all")}
                        onMouseMove={() => ativo !== i && setAtivo(i)}
                        onClick={() => fechar(false)}
                      >
                        {o.item ? (
                          <>
                            <span className="ln-hsearch__opt-title">{destacar(o.item.titulo, termo)}</span>
                            {o.item.meta && <span className="ln-hsearch__opt-meta">{o.item.meta}</span>}
                          </>
                        ) : (
                          <>
                            <span>Ver todos os resultados para “{termo}”</span>
                            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2.5 8h11M9 3.5L13.5 8 9 12.5" />
                            </svg>
                          </>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div role="status" aria-live="polite" className="ln-sr-only">
            {anuncio}
          </div>
        </form>
      )}
    </div>
  );
}
