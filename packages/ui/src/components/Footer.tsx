import type { ReactNode } from "react";
import { cx, type LinkAs } from "../utils";
import { EDITORIAS, defaultEditoriaHref, type EditoriaLike } from "../editorias";
import { Logo } from "./Logo";
import { Container } from "./Layout";
import { SocialLinks, type SocialLink } from "./SocialLinks";

/** Frase institucional exibida sob o logo (definida pelo proprietário; sobrescreva com `tagline`). */
export const FOOTER_TAGLINE = "The global network for board-level loyalty leaders.";

export interface FooterLinkGroup {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}

export interface FooterProps {
  editorias?: readonly EditoriaLike[];
  hrefFor?: (slug: string) => string;
  /** Grupos extras (institucional, legal). Sem padrão: o conteúdo real vem do portal. */
  groups?: readonly FooterLinkGroup[];
  homeHref?: string;
  linkAs?: LinkAs;
  /** Ano exibido no ©. Se omitido, o ano não é renderizado (SSR determinístico). */
  year?: number;
  /** Frase sob o logo. Padrão: FOOTER_TAGLINE. Passe `null` para ocultar. */
  tagline?: ReactNode | null;
  /** Redes e canais (só os que têm URL real aparecem). */
  social?: readonly SocialLink[];
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
  tagline = FOOTER_TAGLINE,
  social = [],
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
              <Logo variant="reverse" height={40} decorative />
            </Link>
            {tagline ? <p className="ln-footer__tagline">{tagline}</p> : null}
            <SocialLinks links={social} className="ln-footer__social" />
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
