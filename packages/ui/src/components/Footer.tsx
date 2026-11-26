import type { ReactNode } from "react";
import { cx, type LinkAs } from "../utils";
import { EDITORIAS, defaultEditoriaHref, type EditoriaLike } from "../editorias";
import { Logo } from "./Logo";
import { Container } from "./Layout";
import { FooterGroup } from "./FooterGroup";
import { SocialLinks, type SocialLink } from "./SocialLinks";

/** Frase institucional exibida sob o logo: a assinatura do Brandkit, em português (o proprietário reverteu a versão em inglês). */
export const FOOTER_TAGLINE = "Inteligência para quem constrói o futuro da fidelidade.";

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
  /** Botão "Entrar" sob a frase da marca (login da redação/Studio). Sem a prop, não aparece. */
  entrar?: { href: string; label: string };
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
  entrar,
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
            {entrar ? (
              <Link href={entrar.href} className="ln-footer__entrar">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
                  <path d="M10 17l5-5-5-5" />
                  <path d="M15 12H4" />
                </svg>
                {entrar.label}
              </Link>
            ) : null}
            <SocialLinks links={social} className="ln-footer__social" />
          </div>
          <div className="ln-footer__groups">
            <FooterGroup title="Editorias" ariaLabel="Editorias (rodapé)" wide>
              <ul className="ln-footer__list ln-footer__list--cols">
                {editorias.map((e) => (
                  <li key={e.slug}>
                    <Link href={hrefFor(e.slug)}>{e.nome}</Link>
                  </li>
                ))}
              </ul>
            </FooterGroup>
            {groups.map((g) => (
              <FooterGroup key={g.title} title={g.title}>
                <ul className="ln-footer__list">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href}>{l.label}</Link>
                    </li>
                  ))}
                </ul>
              </FooterGroup>
            ))}
          </div>
        </div>
        <div className="ln-footer__bottom">
          <p>© {year ? `${year} ` : ""}Loyalty News</p>
          {note ? <p>{note}</p> : null}
        </div>
      </Container>
    </footer>
  );
}
