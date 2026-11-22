import type { ReactNode } from "react";
import { cx } from "../utils";

/**
 * Posições do inventário (espelha `SlotPosition` de @ln/contracts; coberto por teste de paridade).
 * Dimensões de desktop vêm do contrato/wireframe (formatos comerciais Blueprint v2.0 §4):
 * topo 1280×150, sidebar 336×280, rodapé 1280×200. Posições "responsivas" não têm tamanho fixo.
 */
export type AdPosition = "TOP" | "SIDEBAR_1" | "SIDEBAR_2" | "SIDEBAR_3" | "FOOTER" | "ARTICLE_INLINE" | "HOME_BETWEEN" | "AGENDA" | "DATA";

interface PositionSpec {
  label: string;
  /** [largura, altura] em px, ou null quando responsivo/parametrizável. */
  size: readonly [number, number] | null;
}

export const AD_POSITIONS: Record<AdPosition, PositionSpec> = {
  TOP: { label: "Banner topo", size: [1280, 150] },
  SIDEBAR_1: { label: "Sidebar 1", size: [336, 280] },
  SIDEBAR_2: { label: "Sidebar 2", size: [336, 280] },
  SIDEBAR_3: { label: "Sidebar 3", size: [336, 280] },
  FOOTER: { label: "Banner rodapé", size: [1280, 200] },
  ARTICLE_INLINE: { label: "Dentro do artigo", size: null },
  HOME_BETWEEN: { label: "Entre seções", size: null },
  AGENDA: { label: "Agenda", size: null },
  DATA: { label: "Market Data", size: null },
};

export interface AdSlotProps {
  position?: AdPosition;
  /** Anúncio real (injetado pelo módulo comercial quando existir). Sem filhos = placeholder rotulado. */
  children?: ReactNode;
  className?: string;
}

/**
 * Espaço publicitário. Sempre rotulado "Publicidade" (transparência editorial).
 * Sem `children` mostra um placeholder neutro: nenhuma campanha, marca ou métrica é simulada.
 * Reserva o espaço com proporção fixa (evita CLS); em telas estreitas encolhe proporcionalmente.
 */
export function AdSlot({ position = "SIDEBAR_1", children, className }: AdSlotProps) {
  const spec = AD_POSITIONS[position];
  const style = spec.size ? { maxWidth: spec.size[0], aspectRatio: `${spec.size[0]} / ${spec.size[1]}` } : { minHeight: 90 };
  return (
    <div role="group" aria-label="Publicidade" className={cx("ln-ad", `ln-ad--${position.toLowerCase().replace(/_/g, "-")}`, className)}>
      <p className="ln-ad__label">Publicidade</p>
      <div className="ln-ad__box" style={style} data-position={position} data-placeholder={children ? undefined : "true"}>
        {children ?? (
          <span className="ln-ad__empty">
            {spec.label} · {spec.size ? `${spec.size[0]}×${spec.size[1]}` : "responsivo"} · espaço reservado
          </span>
        )}
      </div>
    </div>
  );
}
