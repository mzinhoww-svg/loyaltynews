import type { ReactNode } from "react";
import { cx } from "../utils";

/** Complemento padrão do selo. */
export const MOCK_BADGE_LABEL = "dados de exemplo";

interface MockBadgeProps {
  /**
   * Complemento visível do selo (padrão: "dados de exemplo"). Com `label=""` o selo mostra só "MOCK"
   * (versão compacta, ex.: cartões), mas leitores de tela continuam lendo "MOCK · dados de exemplo".
   */
  label?: string;
  className?: string;
}

/**
 * Selo VISÍVEL de conteúdo simulado (regra 2 do fast-track: todo mock renderizado
 * mostra o texto MOCK). Não esconder, não reduzir abaixo de 12px. O nome acessível é sempre completo.
 */
export function MockBadge({ label = MOCK_BADGE_LABEL, className }: MockBadgeProps) {
  return (
    <span className={cx("ln-mock-badge", className)} data-testid="mock-badge">
      <strong>MOCK</strong>
      {label ? <span> · {label}</span> : <span className="ln-sr-only"> · {MOCK_BADGE_LABEL}</span>}
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
