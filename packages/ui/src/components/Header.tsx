"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, type LinkAs } from "../utils";
import { EDITORIAS, defaultEditoriaHref, type EditoriaLike } from "../editorias";
import { Logo } from "./Logo";
import { Container } from "./Layout";

export interface HeaderLink {
  label: string;
  href: string;
  current?: boolean;
  /** Não aparece na barra superior do desktop; só no menu recolhível (mobile). */
  barHidden?: boolean;
}

export interface HeaderProps {
  /** Padrão: as 10 editorias oficiais. */
  editorias?: readonly EditoriaLike[];
  /** Slug da editoria atual (marca `aria-current="page"`). */
  currentSlug?: string;
  hrefFor?: (slug: string) => string;
  homeHref?: string;
  /** `next/link` ou similar. */
  linkAs?: LinkAs;
  /** Ex.: <SearchInput />. Renderizado uma vez: inline no desktop, em linha própria no mobile. */
  searchSlot?: ReactNode;
  /** Ações à direita (busca, The Loyal…). Visíveis também no mobile: use poucas. */
  actions?: ReactNode;
  /**
   * Atalhos do portal além das editorias (ex.: Em alta, Agenda, Anuncie). No desktop ficam na barra
   * superior, à direita do logo; no mobile entram no menu, abaixo das editorias.
   */
  utilityLinks?: readonly HeaderLink[];
  /** Nome do landmark dos atalhos. */
  utilityLabel?: string;
  /**
   * Quantas editorias aparecem fixas no menu de uma linha em ≥1280px; as demais vão para "Mais".
   * Em 1024–1279px aparecem `wideFrom` itens a menos (ver CSS: sempre 5). Padrão 6.
   */
  visibleEditorias?: number;
  /** id do <main> para o link "Pular para o conteúdo". */
  mainId?: string;
  className?: string;
}

/** Em 1024–1279px só os 5 primeiros cabem; do 6º em diante o item só aparece em ≥1280px. */
const ALWAYS_VISIBLE = 5;

export function Header({
  editorias = EDITORIAS,
  currentSlug,
  hrefFor = defaultEditoriaHref,
  homeHref = "/",
  linkAs,
  searchSlot,
  actions,
  utilityLinks,
  utilityLabel = "Atalhos do portal",
  visibleEditorias = 6,
  mainId = "conteudo",
  className,
}: HeaderProps) {
  const Link = linkAs ?? "a";
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const navId = useId();
  const moreId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const moreWrap = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!open && !moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (moreOpen) {
        setMoreOpen(false);
        moreRef.current?.focus();
      } else {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (moreOpen && moreWrap.current && !moreWrap.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, moreOpen]);

  const visible = Math.max(ALWAYS_VISIBLE, Math.min(visibleEditorias, editorias.length));
  const hasMore = editorias.length > ALWAYS_VISIBLE;
  const moreCurrent = editorias.slice(ALWAYS_VISIBLE).some((e) => e.slug === currentSlug);

  const close = () => {
    setOpen(false);
    setMoreOpen(false);
  };

  return (
    <header className={cx("ln-header", className)}>
      <a className="ln-skip-link" href={`#${mainId}`}>
        Pular para o conteúdo
      </a>
      <div className="ln-header__top">
        <Container className="ln-header__bar">
          <Link href={homeHref} className="ln-header__brand" aria-label="Loyalty News — página inicial">
            <Logo variant="primary" height={36} decorative />
          </Link>
          {searchSlot ? <div className="ln-header__search">{searchSlot}</div> : null}
          {utilityLinks && utilityLinks.some((l) => !l.barHidden) ? (
            <nav aria-label={utilityLabel} className="ln-header__utility">
              <ul className="ln-header__utility-list">
                {utilityLinks
                  .filter((l) => !l.barHidden)
                  .map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} aria-current={l.current ? "page" : undefined}>
                      {l.label}
                    </Link>
                  </li>
                  ))}
              </ul>
            </nav>
          ) : null}
          {actions ? <div className="ln-header__actions">{actions}</div> : null}
          <button
            ref={buttonRef}
            type="button"
            className="ln-header__toggle"
            aria-expanded={open}
            aria-controls={navId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ln-header__toggle-icon" aria-hidden="true" />
            <span>{open ? "Fechar" : "Menu"}</span>
          </button>
        </Container>
      </div>
      <nav id={navId} aria-label="Editorias" className="ln-header__nav" data-open={open ? "true" : "false"}>
        <Container>
          <ul className="ln-header__list">
            {editorias.map((e, i) => (
              <li
                key={e.slug}
                // ≥1280px: fixos até `visible`; 1024–1279px: só os 5 primeiros; o resto vive em "Mais" (desktop) e no painel (mobile)
                className={cx(i >= visible && "ln-header__item--more", i >= ALWAYS_VISIBLE && i < visible && "ln-header__item--wide")}
              >
                <Link
                  href={hrefFor(e.slug)}
                  className="ln-header__link"
                  aria-current={e.slug === currentSlug ? "page" : undefined}
                  onClick={close}
                >
                  {e.nome}
                </Link>
              </li>
            ))}
            {hasMore ? (
              <li ref={moreWrap} className="ln-header__more">
                <button
                  ref={moreRef}
                  type="button"
                  className="ln-header__link ln-header__more-btn"
                  aria-expanded={moreOpen}
                  aria-controls={moreId}
                  data-current={moreCurrent ? "true" : undefined}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  Mais <span aria-hidden="true">▾</span>
                </button>
                <ul id={moreId} className="ln-header__more-panel" hidden={!moreOpen}>
                  {editorias.map((e, i) =>
                    i >= ALWAYS_VISIBLE ? (
                      <li key={e.slug} className={cx(i < visible && "ln-header__more-item--narrow")}>
                        <Link href={hrefFor(e.slug)} aria-current={e.slug === currentSlug ? "page" : undefined} onClick={close}>
                          {e.nome}
                        </Link>
                      </li>
                    ) : null,
                  )}
                </ul>
              </li>
            ) : null}
            {utilityLinks && utilityLinks.length > 0
              ? utilityLinks.map((l, i) => (
                  <li key={`u-${l.href}`} className={cx("ln-header__item--utility", i === 0 && "ln-header__item--utility-first")}>
                    <Link href={l.href} className="ln-header__link" aria-current={l.current ? "page" : undefined} onClick={close}>
                      {l.label}
                    </Link>
                  </li>
                ))
              : null}
          </ul>
        </Container>
      </nav>
    </header>
  );
}
