import { SOURCE, METHODOLOGY_VERSION, type AnalyticsReport } from './aggregate';

// Ponte com o mídia kit (packages/commercial `MetricStore.ingest`): registros com origem, período, horário e metodologia.
// Estrutural de propósito (não importa o pacote comercial). Relatório indisponível NÃO gera registro: o mídia kit mostra
// "— / não disponível" por ausência, nunca zero falso. Cada registro é um agregado; nada individual passa por aqui.

export interface MetricIngestRecord {
  source: string;
  metric: string;
  value: number;
  period_start: string; // ISO
  period_end: string; // ISO
  fetched_at: string; // ISO
  methodology_version: string;
}

/** Início do dia e fim do dia em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019), em ISO com offset. */
const startOf = (day: string): string => `${day}T00:00:00-03:00`;
const endOf = (day: string): string => `${day}T23:59:59-03:00`;

export function toMetricRecords(report: AnalyticsReport): MetricIngestRecord[] {
  if (report.status !== 'available' || report.totalViews === null) return [];
  const base = { source: SOURCE, period_start: startOf(report.period_start), period_end: endOf(report.period_end), fetched_at: report.fetched_at, methodology_version: METHODOLOGY_VERSION };
  const out: MetricIngestRecord[] = [{ ...base, metric: 'pageviews', value: report.totalViews }];
  for (const c of report.referrers) out.push({ ...base, metric: `pageviews_origem_${c.key}`, value: c.views });
  for (const c of report.devices) out.push({ ...base, metric: `pageviews_dispositivo_${c.key}`, value: c.views });
  return out;
}
