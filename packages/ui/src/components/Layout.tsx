import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils";

interface ContainerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** "reading" limita a ~68ch para texto corrido. */
  width?: "default" | "reading";
  children?: ReactNode;
}

export function Container({ as: Tag = "div", width = "default", className, ...rest }: ContainerProps) {
  return <Tag className={cx("ln-container", width === "reading" && "ln-container--reading", className)} {...rest} />;
}

type Cols = 1 | 2 | 3 | 4 | 6 | 12;
interface GridProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Colunas por breakpoint (mobile-first): base < md(768) < lg(1024). */
  cols?: { base?: Cols; md?: Cols; lg?: Cols };
  gap?: "sm" | "md" | "lg";
  children?: ReactNode;
}

export function Grid({ as: Tag = "div", cols = { base: 1 }, gap = "md", className, children, ...rest }: GridProps) {
  return (
    <Tag
      className={cx(
        "ln-grid",
        `ln-grid--gap-${gap}`,
        `ln-grid--c${cols.base ?? 1}`,
        cols.md && `ln-grid--md-c${cols.md}`,
        cols.lg && `ln-grid--lg-c${cols.lg}`,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Conteúdo só para leitores de tela. */
export function VisuallyHidden({ children, as: Tag = "span" }: { children: ReactNode; as?: ElementType }) {
  return <Tag className="ln-sr-only">{children}</Tag>;
}
