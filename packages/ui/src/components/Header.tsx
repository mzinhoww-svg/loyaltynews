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
}

export interface HeaderMenu {
  /** Rótulo do botão do menu, ex.: "Editorias" ou "Notícias". */
  label: string;
  /** Posição do botão entre os links fixos (0 = primeiro). Padrão: 0. */
  position?: number;
  /** Links da coluna "Conteúdo" do menu (ex.: Todas as notícias, Loyalty Flash, Análises). Opcional. */
  contentLinks?: readonly HeaderLink[];
  /** Título da coluna de conteúdo. Padrão "Conteúdo". */
  contentTitle?: string;
  /** Título da coluna de editorias. Padrão "Editorias". */
  editoriasTitle?: string;
  /** Link "Ver todas" ao pé da coluna de editorias. */
  allLink?: { label: string; href: string };
}

export interface HeaderProps {
  /** Padrão: as 10 editorias oficiais (ficam dentro do menu, não na barra). */
  editorias?: readonly EditoriaLike[];
  /** Slug da editoria atual (marca `aria-current="page"` no menu). */
  currentSlug?: string;
  hrefFor?: (slug: string) => string;
  homeHref?: string;
  /** `next/link` ou similar. */
  linkAs?: LinkAs;
  /** Entradas fixas da barra (poucas): ex.: Notícias, Análises, Agenda, Intelligence. */
  links?: readonly HeaderLink[];
  /** Menu "Editorias ▾" / "Notícias ▾" com as editorias (mega-menu no desktop, grupo no menu móvel). */
  menu?: HeaderMenu;
  /** Nome do landmark da barra de links. */
  navLabel?: string;
  /** Ações à direita, sempre visíveis (ícone de busca, The Loyal…). Use poucas. */
  actions?: ReactNode;
  /** Chamada principal (ex.: Anuncie): botão na barra a partir de 768px; no mobile entra no menu. */
  cta?: HeaderLink;
  /** id do <main> para o link "Pular para o conteúdo". */
  mainId?: string;
  className?: string;
}

export function Header({
  editorias = EDITORIAS,
  currentSlug,
  hrefFor = defaultEditoriaHref,
  homeHref = "/",
  linkAs,
  links = [],
  menu,
  navLabel = "Seções do portal",
  actions,
  cta,
  mainId = "conteudo",
  className,
}: HeaderProps) {
  const Link = linkAs ?? "a";
  const [open, setOpen] = useState(false); // painel móvel
  const [megaOpen, setMegaOpen] = useState(false); // mega-menu desktop
  const panelId = useId();
  const megaId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const megaBtnRef = useRef<HTMLButtonElement>(null);
  const megaWrap = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!open && !megaOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (megaOpen) {
        setMegaOpen(false);
        megaBtnRef.current?.focus();
      } else {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (megaOpen && megaWrap.current && !megaWrap.current.contains(e.target as Node)) setMegaOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, megaOpen]);

  const close = () => {
    setOpen(false);
    setMegaOpen(false);
  };
  const menuCurrent = Boolean(menu && (editorias.some((e) => e.slug === currentSlug) || menu.contentLinks?.some((l) => l.current)));
  const pos = menu ? Math.max(0, Math.min(menu.position ?? 0, links.length)) : 0;

  const editoriasList = (cls: string) => (
    <ul className={cls}>
      {editorias.map((e) => (
        <li key={e.slug}>
          <Link href={hrefFor(e.slug)} aria-current={e.slug === currentSlug ? "page" : undefined} onClick={close}>
            {e.nome}
          </Link>
        </li>
      ))}
    </ul>
  );

  const barItems: ReactNode[] = links.map((l) => (
    <li key={l.href}>
      <Link href={l.href} className="ln-header__item" aria-current={l.current ? "page" : undefined}>
        {l.label}
      </Link>
    </li>
  ));
  if (menu) {
    barItems.splice(
      pos,
      0,
      <li key="__menu" ref={megaWrap} className="ln-header__menu">
        <button
          ref={megaBtnRef}
          type="button"
          className="ln-header__item ln-header__menu-btn"
          aria-expanded={megaOpen}
          aria-controls={megaId}
          data-current={menuCurrent ? "true" : undefined}
          onClick={() => setMegaOpen((v) => !v)}
        >
          {menu.label} <span aria-hidden="true" className="ln-header__chevron" />
        </button>
        <div id={megaId} className="ln-header__mega" hidden={!megaOpen}>
          <div className={cx("ln-header__mega-grid", !menu.contentLinks?.length && "ln-header__mega-grid--single")}>
            {menu.contentLinks?.length ? (
              <div className="ln-header__mega-col">
                <p className="ln-header__mega-title">{menu.contentTitle ?? "Conteúdo"}</p>
                <ul className="ln-header__mega-list">
                  {menu.contentLinks.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} aria-current={l.current ? "page" : undefined} onClick={close}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="ln-header__mega-col">
              <p className="ln-header__mega-title">{menu.editoriasTitle ?? "Editorias"}</p>
              {editoriasList("ln-header__mega-list ln-header__mega-list--cols")}
              {menu.allLink ? (
                <Link href={menu.allLink.href} className="ln-header__mega-all" onClick={close}>
                  {menu.allLink.label}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </li>,
    );
  }

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
          {barItems.length > 0 ? (
            <nav aria-label={navLabel} className="ln-header__main">
              <ul className="ln-header__main-list">{barItems}</ul>
            </nav>
          ) : null}
          {actions ? <div className="ln-header__actions">{actions}</div> : null}
          {cta ? (
            <Link href={cta.href} className="ln-btn ln-btn--primary ln-header__cta" aria-current={cta.current ? "page" : undefined}>
              {cta.label}
            </Link>
          ) : null}
          <button
            ref={toggleRef}
            type="button"
            className="ln-header__toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ln-header__toggle-icon" aria-hidden="true" />
            <span>{open ? "Fechar" : "Menu"}</span>
          </button>
        </Container>
      </div>
      {/* Painel do menu móvel (<1024px): links, conteúdo e editorias */}
      <nav id={panelId} aria-label="Menu e editorias" className="ln-header__panel" data-open={open ? "true" : "false"}>
        <Container>
          <ul className="ln-header__panel-list">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} aria-current={l.current ? "page" : undefined} onClick={close}>
                  {l.label}
                </Link>
              </li>
            ))}
            {menu?.contentLinks?.map((l) => (
              <li key={`c-${l.href}`}>
                <Link href={l.href} aria-current={l.current ? "page" : undefined} onClick={close}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          {menu ? (
            <>
              <p className="ln-header__panel-title">{menu.editoriasTitle ?? "Editorias"}</p>
              {editoriasList("ln-header__panel-list ln-header__panel-list--cols")}
            </>
          ) : null}
          {cta ? (
            <Link href={cta.href} className="ln-btn ln-btn--primary ln-header__panel-cta" onClick={close}>
              {cta.label}
            </Link>
          ) : null}
        </Container>
      </nav>
    </header>
  );
}
