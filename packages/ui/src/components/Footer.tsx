import type { ReactNode } from "react";
import { cx, type LinkAs } from "../utils";
import { EDITORIAS, defaultEditoriaHref, type Editoria } from "../editorias";
import { Logo } from "./Logo";
import { Container } from "./Layout";

export interface FooterLinkGroup {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}

export interface FooterProps {
  editorias?: readonly Editoria[];
  hrefFor?: (slug: string) => string;
  /** Grupos extras (institucional, legal). Sem padrão: o conteúdo real vem do portal. */
  groups?: readonly FooterLinkGroup[];
  homeHref?: string;
  linkAs?: LinkAs;
  /** Ano exibido no ©. Se omitido, o ano não é renderizado (SSR determinístico). */
  year?: number;
  /** Texto legal/atribuição. */
  note?: ReactNode;
  className?: string;
}

export function Footer({
  editorias = EDITORIAS,
  hrefFor = defaultEditoriaHref,
  groups = [],
  homeHref = "/",
  linkAs,
  year,
  note,
  className,
}: FooterProps) {
  const Link = linkAs ?? "a";
  return (
    <footer className={cx("ln-footer", "ln-on-inverse", className)}>
      <Container>
        <div className="ln-footer__grid">
          <div className="ln-footer__brand">
            <Link href={homeHref} aria-label="Loyalty News — página inicial">
              <Logo variant="reverse" height={36} decorative />
            </Link>
          </div>
          <nav aria-label="Editorias (rodapé)" className="ln-footer__col ln-footer__col--wide">
            <h2 className="ln-footer__title">Editorias</h2>
            <ul className="ln-footer__list ln-footer__list--cols">
              {editorias.map((e) => (
                <li key={e.slug}>
                  <Link href={hrefFor(e.slug)}>{e.nome}</Link>
                </li>
              ))}
            </ul>
          </nav>
          {groups.map((g) => (
            <nav key={g.title} aria-label={g.title} className="ln-footer__col">
              <h2 className="ln-footer__title">{g.title}</h2>
              <ul className="ln-footer__list">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="ln-footer__bottom">
          <p>© {year ? `${year} ` : ""}Loyalty News</p>
          {note ? <p>{note}</p> : null}
        </div>
      </Container>
    </footer>
  );
}
