import { cx, type LinkAs } from "../utils";

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Gera a URL de cada página (preferido: links reais, funciona sem JS e indexável). */
  hrefFor?: (page: number) => string;
  /** Alternativa: callback (renderiza botões). */
  onPageChange?: (page: number) => void;
  linkAs?: LinkAs;
  /** Páginas vizinhas exibidas de cada lado da atual. */
  siblings?: number;
  className?: string;
}

/** Sequência com reticências: [1, "…", 4, 5, 6, "…", 20]. */
export function pageRange(page: number, total: number, siblings = 1): Array<number | "…"> {
  const first = 1;
  const start = Math.max(first + 1, page - siblings);
  const end = Math.min(total - 1, page + siblings);
  const out: Array<number | "…"> = [first];
  if (start > first + 1) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  if (total > 1) out.push(total);
  return out;
}

export function Pagination({ page, totalPages, hrefFor, onPageChange, linkAs, siblings = 1, className }: PaginationProps) {
  if (totalPages <= 1) return null;
  const Link = linkAs ?? "a";
  const item = (target: number, label: string, content: React.ReactNode, current = false) => {
    const disabled = target < 1 || target > totalPages;
    const cls = cx("ln-page", current && "ln-page--current", disabled && "ln-page--disabled");
    if (disabled) {
      return (
        <span className={cls} aria-disabled="true">
          {content}
        </span>
      );
    }
    if (hrefFor) {
      return (
        <Link href={hrefFor(target)} className={cls} aria-label={label} aria-current={current ? "page" : undefined}>
          {content}
        </Link>
      );
    }
    return (
      <button type="button" className={cls} aria-label={label} aria-current={current ? "page" : undefined} onClick={() => onPageChange?.(target)}>
        {content}
      </button>
    );
  };
  return (
    <nav aria-label="Paginação" className={cx("ln-pagination", className)}>
      <ul className="ln-pagination__list">
        <li>{item(page - 1, "Página anterior", <span aria-hidden="true">‹ Anterior</span>)}</li>
        {pageRange(page, totalPages, siblings).map((p, i) =>
          p === "…" ? (
            <li key={`e${i}`} className="ln-pagination__gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={p} className="ln-pagination__num">
              {item(p, `Página ${p}`, p, p === page)}
            </li>
          ),
        )}
        <li>{item(page + 1, "Próxima página", <span aria-hidden="true">Próxima ›</span>)}</li>
      </ul>
    </nav>
  );
}
