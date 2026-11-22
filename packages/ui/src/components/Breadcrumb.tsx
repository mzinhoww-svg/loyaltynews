import { cx, type LinkAs } from "../utils";

export interface BreadcrumbItem {
  label: string;
  /** Omitir no último item (página atual). */
  href?: string;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  linkAs?: LinkAs;
  className?: string;
}

export function Breadcrumb({ items, linkAs, className }: BreadcrumbProps) {
  const Link = linkAs ?? "a";
  return (
    <nav aria-label="Você está aqui" className={cx("ln-breadcrumb", className)}>
      <ol className="ln-breadcrumb__list">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${it.label}-${i}`} className="ln-breadcrumb__item">
              {last || !it.href ? (
                <span aria-current={last ? "page" : undefined}>{it.label}</span>
              ) : (
                <Link href={it.href}>{it.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
