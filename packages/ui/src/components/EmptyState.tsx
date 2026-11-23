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
  /**
   * box = bloco centralizado (páginas inteiras vazias); inline = uma linha discreta (seções de uma página
   * que tem outros conteúdos). No modo inline o título vira texto em negrito, não um heading.
   */
  appearance?: "box" | "inline";
  className?: string;
}

/** Estado vazio honesto: sem ilustração enganosa nem dados de exemplo. */
export function EmptyState({ title, description, action, kind = "empty", headingLevel = 2, appearance = "box", className }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  if (appearance === "inline") {
    return (
      <section className={cx("ln-empty", "ln-empty--inline", `ln-empty--${kind}`, className)} role={kind === "error" ? "alert" : "status"}>
        <p className="ln-empty__line">
          <strong className="ln-empty__title">{title}</strong>
          {description ? <span className="ln-empty__desc"> {description}</span> : null}
        </p>
        {action ? <div className="ln-empty__action">{action}</div> : null}
      </section>
    );
  }
  return (
    <section className={cx("ln-empty", `ln-empty--${kind}`, className)} role={kind === "error" ? "alert" : "status"}>
      <Heading className="ln-empty__title">{title}</Heading>
      {description ? <p className="ln-empty__desc">{description}</p> : null}
      {action ? <div className="ln-empty__action">{action}</div> : null}
    </section>
  );
}
