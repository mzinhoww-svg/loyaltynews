import type { ReactNode } from "react";
import { cx } from "../utils";

export interface EmptyStateProps {
  /** Diga a verdade: "Nenhuma matéria publicada nesta editoria ainda." */
  title: string;
  description?: ReactNode;
  /** Ex.: <Button href="/">Voltar à home</Button>. */
  action?: ReactNode;
  /**
   * empty = não há dados; error = falha ao carregar; unavailable = recurso ainda não ativo (feature flag).
   * `error` usa role="alert"; os demais, role="status".
   */
  kind?: "empty" | "error" | "unavailable";
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** Estado vazio honesto: sem ilustração enganosa nem dados de exemplo. */
export function EmptyState({ title, description, action, kind = "empty", headingLevel = 2, className }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <section className={cx("ln-empty", `ln-empty--${kind}`, className)} role={kind === "error" ? "alert" : "status"}>
      <Heading className="ln-empty__title">{title}</Heading>
      {description ? <p className="ln-empty__desc">{description}</p> : null}
      {action ? <div className="ln-empty__action">{action}</div> : null}
    </section>
  );
}
