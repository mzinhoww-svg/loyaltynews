import { cx } from "../utils";

/** Texto fixo exigido pelo Security (decisão da vitrine de staging, R5). Não altere sem nova decisão. */
export const DEMO_BANNER_TEXT = "Conteúdo de demonstração — não publicado";

export interface DemoBannerProps {
  className?: string;
}

/**
 * Faixa fina (28px) no topo de TODA página quando o portal exibe conteúdo de demonstração (vitrine do staging).
 * Fica antes do cabeçalho, ocupa a largura toda e não pode ser ocultada por prop.
 * Quem decide renderizar é o portal (guard por ambiente); este componente só define a aparência.
 */
export function DemoBanner({ className }: DemoBannerProps) {
  return (
    <div className={cx("ln-demo-banner", className)} role="note" data-testid="demo-banner">
      {DEMO_BANNER_TEXT}
    </div>
  );
}
