import type { ReactNode } from "react";
import { cx } from "../utils";

interface MockBadgeProps {
  /** Complemento do selo, ex.: "dados de exemplo". */
  label?: string;
  className?: string;
}

/**
 * Selo VISÍVEL de conteúdo simulado (regra 2 do fast-track: todo mock renderizado
 * mostra o texto MOCK). Não esconder, não reduzir abaixo de 12px.
 */
export function MockBadge({ label = "dados de exemplo", className }: MockBadgeProps) {
  return (
    <span className={cx("ln-mock-badge", className)} data-testid="mock-badge">
      <strong>MOCK</strong>
      {label ? <span> · {label}</span> : null}
    </span>
  );
}

/** Envolve um bloco simulado com contorno tracejado + selo MOCK. */
export function MockFrame({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="ln-mock-frame">
      <MockBadge label={label} />
      {children}
    </div>
  );
}
