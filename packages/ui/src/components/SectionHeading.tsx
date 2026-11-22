import type { ReactNode } from "react";
import { cx, type LinkAs } from "../utils";

export interface SectionHeadingProps {
  title: string;
  /** Texto curto acima do título (ex.: "Em Alta"). */
  eyebrow?: string;
  description?: string;
  level?: 1 | 2 | 3 | 4;
  /** Link "Ver todas" à direita. */
  action?: { label: string; href: string };
  linkAs?: LinkAs;
  id?: string;
  children?: ReactNode;
  className?: string;
}

export function SectionHeading({ title, eyebrow, description, level = 2, action, linkAs, id, className }: SectionHeadingProps) {
  const Link = linkAs ?? "a";
  const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4";
  return (
    <div className={cx("ln-section-heading", level === 1 && "ln-section-heading--page", className)}>
      <div className="ln-section-heading__text">
        {eyebrow ? <p className="ln-section-heading__eyebrow">{eyebrow}</p> : null}
        <Heading id={id} className="ln-section-heading__title">
          {title}
        </Heading>
        {description ? <p className="ln-section-heading__desc">{description}</p> : null}
      </div>
      {action ? (
        <Link href={action.href} className="ln-section-heading__action">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
