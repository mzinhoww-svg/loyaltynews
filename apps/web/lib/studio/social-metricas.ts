// Métricas do LinkedIn lidas do mLabs (só leitura; @ln/growth createMlabsMetricsSource) como o Social dashboard as mostra.
// Regras: valor ausente vira "—", nunca 0; 0 real aparece como 0 (e vem dito que é leitura do mLabs); sem soma parcial; nada estimado.
import type { DashboardSummary } from '@ln/growth/dashboard';

type Metricas = DashboardSummary['metrics'];
export type EstadoMetrica = 'ok' | 'sem_dados' | 'indisponivel';

export interface CelulaMetrica {
  rotulo: string;
  estado: EstadoMetrica;
  /** Texto do número ("0", "1.234") ou "—" quando não há valor. */
  valor: string;
  nota: string | null;
}
export interface PostMetricaVista {
  chave: string;
  data: string;
  tipo: string;
  curtidas: string;
  comentarios: string;
  visualizacoes: string;
}
export type MetricasVista =
  | { disponivel: false; motivo: string }
  | { disponivel: true; periodo: string; lidoEm: string; celulas: CelulaMetrica[]; posts: PostMetricaVista[]; cortada: boolean };

const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n.toLocaleString('pt-BR'));
const ROTULO_ESTADO: Record<EstadoMetrica, string> = { ok: 'lido do mLabs', sem_dados: 'sem dados no mLabs', indisponivel: 'indisponível' };

export function rotuloEstado(e: EstadoMetrica): string {
  return ROTULO_ESTADO[e];
}

export function metricasVista(m: Metricas): MetricasVista {
  if (!m.available) return { disponivel: false, motivo: m.reason };
  const d = m.data;
  const p = d.published;
  const f = d.followers;
  const celulas: CelulaMetrica[] = [
    {
      rotulo: 'Posts publicados no período',
      estado: p.status,
      valor: p.status === 'ok' ? fmt(p.count) : '—',
      nota: p.status === 'ok' ? (p.truncated ? 'Total informado pelo mLabs; a lista abaixo foi cortada.' : null) : (p.reason ?? null),
    },
    {
      rotulo: 'Seguidores',
      estado: f.status,
      valor: f.status === 'ok' ? fmt(f.current) : '—',
      nota:
        f.status === 'ok'
          ? f.observedAt
            ? `Última observação do mLabs em ${f.observedAt.slice(0, 10)} (${f.observations} ${f.observations === 1 ? 'observação' : 'observações'}).`
            : 'O mLabs não informou a data da observação.'
          : (f.reason ?? null),
    },
    {
      rotulo: 'Crescimento de seguidores',
      estado: f.status,
      valor: f.status === 'ok' ? (f.growth === null ? '—' : `${f.growth > 0 ? '+' : ''}${fmt(f.growth)}`) : '—',
      nota: f.status === 'ok' && f.growth === null ? 'Menos de duas observações no período.' : null,
    },
  ];
  for (const [k, rot] of [['likes', 'Curtidas'], ['comments', 'Comentários'], ['views', 'Visualizações']] as const) {
    const v = p.status === 'ok' ? p.totals[k] : null;
    celulas.push({
      rotulo: `${rot} (soma dos posts)`,
      estado: p.status,
      valor: fmt(v),
      nota: p.status === 'ok' && v === null && p.items.length > 0 ? 'Algum post veio sem este campo: não somamos parcial.' : null,
    });
  }
  return {
    disponivel: true,
    periodo: `${d.period.start} a ${d.period.end}`,
    lidoEm: d.fetchedAt,
    celulas,
    posts: p.items.map((it, i) => ({
      chave: it.id ?? `sem-id-${i}`,
      data: it.publishedAt ? it.publishedAt.slice(0, 10) : '—',
      tipo: it.type ?? '—',
      curtidas: fmt(it.likes),
      comentarios: fmt(it.comments),
      visualizacoes: fmt(it.views),
    })),
    cortada: p.truncated,
  };
}
