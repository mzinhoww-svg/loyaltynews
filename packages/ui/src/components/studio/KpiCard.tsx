import { cx } from "../../utils";
import { MockBadge } from "../MockBadge";

export interface KpiCardProps {
  /** Nome do indicador, ex.: "Matérias publicadas". */
  label: string;
  /** Valor já formatado. `null`/`undefined` = sem dados (estado vazio honesto, nunca zero inventado). */
  value: string | number | null | undefined;
  /** ORIGEM do dado (sistema/consulta/relatório). Obrigatória: sem origem o número não é exibido. */
  source: string;
  /** PERÍODO a que o dado se refere (ex.: "últimos 7 dias", "01–21/11/2026"). Obrigatório. */
  period: string;
  unit?: string;
  /** Variação já calculada e formatada, ex.: "+4,2%". Opcional. */
  delta?: { text: string; direction: "up" | "down" | "flat" };
  /** Dado simulado: exibe o selo MOCK. */
  isMock?: boolean;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

const blank = (s: string | undefined) => !s || !s.trim();

/**
 * Cartão de indicador. Regra editorial/comercial do fast-track: métrica sem origem e período
 * não é mostrada. Se faltarem, o cartão exibe um aviso de indicador inválido no lugar do número.
 */
export function KpiCard({ label, value, source, period, unit, delta, isMock, headingLevel = 3, className }: KpiCardProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const invalid = blank(source) || blank(period);
  const empty = value === null || value === undefined || value === "";
  return (
    <section className={cx("ln-kpi", invalid && "ln-kpi--invalid", className)} aria-label={label}>
      <Heading className="ln-kpi__label">{label}</Heading>
      {invalid ? (
        <p className="ln-kpi__invalid" role="alert">
          Indicador inválido: informe {blank(source) ? "a origem" : ""}
          {blank(source) && blank(period) ? " e " : ""}
          {blank(period) ? "o período" : ""} do dado.
        </p>
      ) : (
        <>
          <p className={cx("ln-kpi__value", empty && "ln-kpi__value--empty")}>
            {empty ? (
              <>
                <span aria-hidden="true">—</span>
                <span className="ln-sr-only">Sem dados</span>
              </>
            ) : (
              <>
                {value}
                {unit ? <span className="ln-kpi__unit"> {unit}</span> : null}
              </>
            )}
          </p>
          {empty ? <p className="ln-kpi__note">Sem dados no período.</p> : null}
          {delta && !empty ? (
            <p className={cx("ln-kpi__delta", `ln-kpi__delta--${delta.direction}`)}>
              <span aria-hidden="true">{delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "■"}</span>{" "}
              <span className="ln-sr-only">{delta.direction === "up" ? "Alta de " : delta.direction === "down" ? "Queda de " : "Estável: "}</span>
              {delta.text}
            </p>
          ) : null}
          <dl className="ln-kpi__meta">
            <div>
              <dt>Origem</dt>
              <dd>{source}</dd>
            </div>
            <div>
              <dt>Período</dt>
              <dd>{period}</dd>
            </div>
          </dl>
        </>
      )}
      {isMock ? <MockBadge /> : null}
    </section>
  );
}
