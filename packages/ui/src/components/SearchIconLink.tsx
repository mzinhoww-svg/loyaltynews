import { cx, type LinkAs } from "../utils";

export interface SearchIconLinkProps {
  href?: string;
  /** Nome acessível do botão (o ícone é decorativo). */
  label?: string;
  linkAs?: LinkAs;
  className?: string;
}

/** Ícone de busca como link (cabeçalho). Alvo de 44px; abre a página de busca. */
export function SearchIconLink({ href = "/busca", label = "Busca", linkAs, className }: SearchIconLinkProps) {
  const Link = linkAs ?? "a";
  return (
    <Link href={href} className={cx("ln-icon-link", className)} aria-label={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16.2 16.2L20 20" />
      </svg>
    </Link>
  );
}
