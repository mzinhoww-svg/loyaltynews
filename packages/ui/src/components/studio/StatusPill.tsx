import { cx } from "../../utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Glifo por tom: o estado nunca depende só de cor (WCAG 1.4.1). */
const GLYPH: Record<StatusTone, string> = { neutral: "○", info: "◐", success: "✓", warning: "!", danger: "✕" };

export interface StatusPillProps {
  /** Texto do estado, ex.: "Em revisão". Obrigatório e sempre visível. */
  label: string;
  tone?: StatusTone;
  className?: string;
}

export function StatusPill({ label, tone = "neutral", className }: StatusPillProps) {
  return (
    <span className={cx("ln-pill", `ln-pill--${tone}`, className)}>
      <span className="ln-pill__glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      {label}
    </span>
  );
}
