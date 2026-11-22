import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx, type LinkAs } from "../../utils";

export interface SidebarItem {
  label: string;
  href: string;
  current?: boolean;
  /** Contador/rótulo curto (ex.: pendências). */
  badge?: string | number;
}
export interface SidebarGroup {
  title?: string;
  items: readonly SidebarItem[];
}

export interface SidebarProps {
  groups: readonly SidebarGroup[];
  /** Marca do topo (ex.: "LN Studio"). */
  brand?: ReactNode;
  /** Rodapé (ex.: ambiente/workspace). */
  footer?: ReactNode;
  /** Nome do landmark de navegação. */
  label?: string;
  linkAs?: LinkAs;
  className?: string;
}

/**
 * Navegação lateral do LN Studio. Desktop: coluna fixa. Mobile (<1024px): barra com botão
 * "Navegação" que abre/fecha a lista (aria-expanded, Esc fecha). Os itens vêm por props:
 * as rotas pertencem ao app do Studio.
 */
export function Sidebar({ groups, brand, footer, label = "Navegação do Studio", linkAs, className }: SidebarProps) {
  const Link = linkAs ?? "a";
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <aside className={cx("ln-sidebar", "ln-on-inverse", className)}>
      <div className="ln-sidebar__top">
        {brand ? <div className="ln-sidebar__brand">{brand}</div> : null}
        <button ref={btn} type="button" className="ln-sidebar__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          {open ? "Fechar navegação" : "Navegação"}
        </button>
      </div>
      <nav id={id} aria-label={label} className="ln-sidebar__nav" data-open={open ? "true" : "false"}>
        {groups.map((g, gi) => {
          const heading = g.title ? `${id}-g${gi}` : undefined;
          return (
            <div key={gi} className="ln-sidebar__group">
              {g.title ? (
                <p id={heading} className="ln-sidebar__group-title">
                  {g.title}
                </p>
              ) : null}
              <ul className="ln-sidebar__list" aria-labelledby={heading}>
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} className="ln-sidebar__link" aria-current={it.current ? "page" : undefined} onClick={() => setOpen(false)}>
                      <span>{it.label}</span>
                      {it.badge !== undefined ? <span className="ln-sidebar__badge">{it.badge}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      {footer ? <div className="ln-sidebar__footer">{footer}</div> : null}
    </aside>
  );
}
