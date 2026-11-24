import type { SocialMetrics } from './mlabs-metrics';

// Ponte das métricas sociais (mLabs, só leitura) com o armazém de métricas do mídia kit (packages/commercial `MetricStore.ingest`) e com o painel de
// analytics do Studio (R5-10, parte social). Estrutural de propósito (mesmo formato de `MetricIngestRecord` de @ln/analytics; não importa o pacote).
// Regras: só seção com status `ok` gera registro; valor ausente (null) NUNCA vira zero nem registro (o painel mostra "— / não disponível" por ausência);
// cada registro leva fonte, período, horário da leitura e a versão da metodologia. Nada é publicado nem escrito no mLabs.

export interface SocialMetricRecord {
  source: string;
  metric: string;
  value: number;
  period_start: string; // ISO
  period_end: string; // ISO
  fetched_at: string; // ISO
  methodology_version: string;
}

export const SOCIAL_SOURCE = 'mlabs:linkedin';
export const SOCIAL_METHODOLOGY_VERSION = 'mlabs-leitura-1';

/** Início e fim do dia (America/Sao_Paulo, UTC-3 sem horário de verão desde 2019), como no restante das métricas. */
const startOf = (day: string): string => `${day}T00:00:00-03:00`;
const endOf = (day: string): string => `${day}T23:59:59-03:00`;

export function socialMetricsToRecords(m: SocialMetrics): SocialMetricRecord[] {
  const out: SocialMetricRecord[] = [];
  const base = { source: SOCIAL_SOURCE, fetched_at: m.fetchedAt, methodology_version: SOCIAL_METHODOLOGY_VERSION };
  const period = { period_start: startOf(m.period.start), period_end: endOf(m.period.end) };
  const push = (metric: string, value: number | null, p: { period_start: string; period_end: string }) => {
    if (value !== null && Number.isFinite(value)) out.push({ ...base, ...p, metric, value });
  };
  if (m.published.status === 'ok') {
    push('social_posts_publicados', m.published.count, period);
    // soma só quando TODOS os posts trazem o campo (a leitura já devolve null caso contrário)
    push('social_curtidas_total', m.published.totals.likes, period);
    push('social_comentarios_total', m.published.totals.comments, period);
    push('social_visualizacoes_total', m.published.totals.views, period);
  }
  if (m.followers.status === 'ok') {
    // contagem observada num instante (a coleta do mLabs não é diária): o período é o dia da última observação
    const day = m.followers.observedAt ? m.followers.observedAt.slice(0, 10) : null;
    if (day) {
      const at = { period_start: startOf(day), period_end: endOf(day) };
      push('social_seguidores', m.followers.current, at);
    }
    push('social_seguidores_crescimento', m.followers.growth, period);
  }
  return out;
}
