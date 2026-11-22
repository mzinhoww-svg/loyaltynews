import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, type LinkAs } from "../utils";
import { EDITORIAS, defaultEditoriaHref, type Editoria } from "../editorias";
import { Logo } from "./Logo";
import { Container } from "./Layout";

export interface HeaderProps {
  /** Padrão: as 10 editorias oficiais. */
  editorias?: readonly Editoria[];
  /** Slug da editoria atual (marca `aria-current="page"`). */
  currentSlug?: string;
  hrefFor?: (slug: string) => string;
  homeHref?: string;
  /** `next/link` ou similar. */
  linkAs?: LinkAs;
  /** Ex.: <SearchInput />. Renderizado na barra superior (desktop) e abaixo do logo (mobile). */
  searchSlot?: ReactNode;
  /** Ações à direita (login, etc.). */
  actions?: ReactNode;
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
  searchSlot,
  actions,
  mainId = "conteudo",
  className,
}: HeaderProps) {
  const Link = linkAs ?? "a";
  const [open, setOpen] = useState(false);
  const navId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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
          {searchSlot ? <div className="ln-header__search ln-header__search--desktop">{searchSlot}</div> : null}
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
            <span>{open ? "Fechar menu" : "Menu"}</span>
          </button>
        </Container>
        {searchSlot ? (
          <Container className="ln-header__search ln-header__search--mobile">{searchSlot}</Container>
        ) : null}
      </div>
      <nav id={navId} aria-label="Editorias" className="ln-header__nav" data-open={open ? "true" : "false"}>
        <Container>
          <ul className="ln-header__list">
            {editorias.map((e) => (
              <li key={e.slug}>
                <Link
                  href={hrefFor(e.slug)}
                  className="ln-header__link"
                  aria-current={e.slug === currentSlug ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {e.nome}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </nav>
    </header>
  );
}
