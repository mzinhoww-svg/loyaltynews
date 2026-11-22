import type { ReactNode } from "react";
import { cx, type LinkAs } from "../utils";
import { defaultEditoriaHref, type Editoria } from "../editorias";

interface TagProps {
  children: ReactNode;
  href?: string;
  linkAs?: LinkAs;
  className?: string;
}

/** Etiqueta neutra (tag de matéria). Vira link quando recebe `href`. */
export function Tag({ children, href, linkAs, className }: TagProps) {
  const Link = linkAs ?? "a";
  return href ? (
    <Link href={href} className={cx("ln-tag", "ln-tag--link", className)}>
      {children}
    </Link>
  ) : (
    <span className={cx("ln-tag", className)}>{children}</span>
  );
}

interface EditoriaBadgeProps {
  editoria: Pick<Editoria, "slug" | "nome">;
  /** Renderiza como link para a editoria (padrão: false, texto simples). */
  asLink?: boolean;
  hrefFor?: (slug: string) => string;
  linkAs?: LinkAs;
  className?: string;
}

export function EditoriaBadge({ editoria, asLink = false, hrefFor = defaultEditoriaHref, linkAs, className }: EditoriaBadgeProps) {
  const Link = linkAs ?? "a";
  return asLink ? (
    <Link href={hrefFor(editoria.slug)} className={cx("ln-badge", "ln-badge--link", className)}>
      {editoria.nome}
    </Link>
  ) : (
    <span className={cx("ln-badge", className)}>{editoria.nome}</span>
  );
}
