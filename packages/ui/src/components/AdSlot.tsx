import type { ReactNode } from "react";
import { cx } from "../utils";

export type AdFormat = "leaderboard" | "billboard" | "mrec" | "mobile-banner";

/** Dimensões IAB em px (apenas reserva de espaço; evita CLS). */
export const AD_SIZES: Record<AdFormat, readonly [number, number]> = {
  leaderboard: [728, 90],
  billboard: [970, 250],
  mrec: [300, 250],
  "mobile-banner": [320, 100],
};

export interface AdSlotProps {
  format?: AdFormat;
  /** Anúncio real (injetado pelo módulo comercial quando existir). Sem filhos = placeholder rotulado. */
  children?: ReactNode;
  className?: string;
}

/**
 * Espaço publicitário. Sempre rotulado "Publicidade" (transparência editorial).
 * Sem `children` mostra um placeholder neutro: nenhuma campanha, marca ou métrica é simulada.
 */
export function AdSlot({ format = "mrec", children, className }: AdSlotProps) {
  const [w, h] = AD_SIZES[format];
  return (
    <div role="group" aria-label="Publicidade" className={cx("ln-ad", `ln-ad--${format}`, className)}>
      <p className="ln-ad__label">Publicidade</p>
      <div className="ln-ad__box" style={{ maxWidth: w, aspectRatio: `${w} / ${h}` }} data-format={format} data-placeholder={children ? undefined : "true"}>
        {children ?? <span className="ln-ad__empty">Espaço reservado · {w}×{h}</span>}
      </div>
    </div>
  );
}
