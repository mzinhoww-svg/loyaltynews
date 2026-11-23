import type { ReactNode } from "react";
import { cx } from "../../utils";

export interface StudioLayoutProps {
  /** <Sidebar />. */
  sidebar: ReactNode;
  children: ReactNode;
  /** id do <main> (alvo do "Pular para o conteúdo"). */
  mainId?: string;
  className?: string;
}

/** Casca do LN Studio: Sidebar à esquerda (desktop) / no topo (mobile) + área de conteúdo. */
export function StudioLayout({ sidebar, children, mainId = "conteudo", className }: StudioLayoutProps) {
  return (
    <div className={cx("ln-root", "ln-studio", className)}>
      <a className="ln-skip-link" href={`#${mainId}`}>
        Pular para o conteúdo
      </a>
      {sidebar}
      <main id={mainId} className="ln-studio__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
