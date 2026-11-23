// Mídia kit gerado por código: 8 blocos (Blueprint v2.0 §4). Métricas só vêm do MetricStore; sem registro => estado vazio honesto.
import { CATALOG, PACKAGES, priceLabel } from './catalog';
import type { CommercialFormat, MetricRecord } from './types';
import { POSITIONS, theoreticalGrossCapacity } from './inventory';
import { MetricStore, displayMetric } from './metrics';

export interface MetricSlot { block: 'cobertura' | 'audiencia'; label: string; source: string; metric: string; klass: 'realtime' | 'historical' }
export const METRIC_SLOTS: readonly MetricSlot[] = [
  { block: 'cobertura', label: 'Matérias publicadas (30 dias)', source: 'cms', metric: 'articles_published_30d', klass: 'historical' },
  { block: 'cobertura', label: 'Matérias publicadas (90 dias)', source: 'cms', metric: 'articles_published_90d', klass: 'historical' },
  { block: 'cobertura', label: 'Eventos futuros', source: 'cms', metric: 'upcoming_events', klass: 'historical' },
  { block: 'audiencia', label: 'Usuários ativos agora (últimos 30 min)', source: 'ga4_realtime', metric: 'active_users_30min', klass: 'realtime' },
  { block: 'audiencia', label: 'Sessões (30 dias)', source: 'ga4_report', metric: 'sessions_30d', klass: 'historical' },
  { block: 'audiencia', label: 'Usuários ativos (30 dias)', source: 'ga4_report', metric: 'active_users_30d', klass: 'historical' },
  { block: 'audiencia', label: 'Visualizações de página (30 dias)', source: 'ga4_report', metric: 'page_views_30d', klass: 'historical' },
  { block: 'audiencia', label: 'The Loyal — assinantes confirmados', source: 'esp', metric: 'confirmed_subscribers', klass: 'historical' },
  { block: 'audiencia', label: 'LinkedIn — seguidores', source: 'linkedin', metric: 'followers', klass: 'historical' },
];

export interface MediaKitMetric { label: string; display: string; record: MetricRecord }
export interface MediaKit {
  generatedAt: string;
  methodologyNote: string;
  blocks: {
    cobertura: { metrics: MediaKitMetric[]; emptyState: string | null };
    audiencia: { metrics: MediaKitMetric[]; emptyState: string | null; note: string };
    decisores: { available: false; emptyState: string };
    tese: { text: string };
    especificacoes: { positions: typeof POSITIONS; mobileNote: string; formats: string };
    catalogo: { total: number; byStatus: Record<string, number>; formats: { id: string; section: string; name: string; price: string; scope: string; status: string; statusReason: string }[]; packages: typeof PACKAGES; disclaimer: string; capacityScenario: ReturnType<typeof theoreticalGrossCapacity> };
    contratacao: { steps: string[] };
    formulario: { fields: { name: string; required: boolean }[]; newsletterOptInSeparate: true };
  };
}

function build(slots: readonly MetricSlot[], store: MetricStore, now: string): { metrics: MediaKitMetric[]; allEmpty: boolean } {
  const metrics = slots.map((s) => {
    const record = store.get({ source: s.source, metric: s.metric }, now, s.klass);
    return { label: s.label, display: displayMetric(record), record };
  });
  return { metrics, allEmpty: metrics.every((m) => m.record.status === 'unavailable') };
}

export function generateMediaKit(opts: { store: MetricStore; now: string; catalog?: readonly CommercialFormat[] }): MediaKit {
  const catalog = opts.catalog ?? CATALOG;
  const cob = build(METRIC_SLOTS.filter((s) => s.block === 'cobertura'), opts.store, opts.now);
  const aud = build(METRIC_SLOTS.filter((s) => s.block === 'audiencia'), opts.store, opts.now);
  const byStatus: Record<string, number> = { disponivel: 0, sob_consulta: 0, indisponivel: 0 };
  for (const f of catalog) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  return {
    generatedAt: opts.now,
    methodologyNote: 'Toda métrica traz origem, período e horário da coleta. Sem conector: "— / não disponível". Valores e capacidades não garantem audiência ou faturamento.',
    blocks: {
      cobertura: { metrics: cob.metrics, emptyState: cob.allEmpty ? 'Sem dados de cobertura coletados do CMS ainda.' : null },
      audiencia: {
        metrics: aud.metrics,
        emptyState: aud.allEmpty ? 'Sem analytics conectado ainda: nenhuma audiência é exibida até haver coleta real.' : null,
        note: 'Contatos por canal não são deduplicados nem somados entre canais. "Agora" é a janela GA4 Realtime de 30 minutos; os demais são históricos com período explícito.',
      },
      decisores: { available: false, emptyState: 'Perfil de decisores só é exibido com evidência mensurada; não há evidência coletada.' },
      tese: { text: 'Mídia especializada B2B em fidelização, com publieditoriais sempre rotulados e separação entre comercial e editorial.' },
      especificacoes: { positions: POSITIONS, mobileNote: 'Mobile sugerido 320x100 e 300x250; variante obrigatória quando aplicável. Formatos: JPG, PNG, GIF e HTML5 em sandbox após análise.', formats: 'Posições sem limite configurado não são reserváveis.' },
      catalogo: {
        total: catalog.length, byStatus,
        formats: catalog.map((f) => ({ id: f.id, section: f.section, name: f.name, price: priceLabel(f), scope: f.scope, status: f.status, statusReason: f.statusReason })),
        packages: PACKAGES,
        disclaimer: 'Preços de referência em BRL, ajustáveis; disponibilidade é real. Nenhum formato sem capacidade operacional fica disponível para venda.',
        capacityScenario: theoreticalGrossCapacity(),
      },
      contratacao: { steps: ['Lead pelo formulário', 'Qualificação no CRM', 'Proposta versionada', 'Aceite/contrato', 'Reserva de inventário', 'Criativo e QA', 'Aprovação do cliente', 'Ativação', 'Monitoramento de entrega', 'Relatório e renovação'] },
      formulario: { fields: [{ name: 'nome', required: true }, { name: 'empresa', required: true }, { name: 'email', required: true }, { name: 'whatsapp', required: false }, { name: 'formatos', required: false }, { name: 'objetivo', required: false }, { name: 'mensagem', required: false }, { name: 'newsletter_opt_in', required: false }], newsletterOptInSeparate: true },
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const metricLine = (m: MediaKitMetric) => {
  const r = m.record;
  const meta = r.status === 'unavailable' ? 'sem coleta' : `origem ${esc(r.source)}; período ${esc(r.period_start ?? '—')} a ${esc(r.period_end ?? '—')}; coletado em ${esc(r.fetched_at ?? '—')}; metodologia ${esc(r.methodology_version)}`;
  return `<li><strong>${esc(m.label)}</strong>: ${esc(m.display)} <small>(${meta})</small></li>`;
};

/** Renderização HTML estática do mídia kit (sem script, sem rede). */
export function renderMediaKitHtml(kit: MediaKit): string {
  const b = kit.blocks;
  const rows = b.catalogo.formats.map((f) => `<tr><td>${esc(f.section)}</td><td>${esc(f.name)}</td><td>${esc(f.price)}</td><td>${esc(f.scope)}</td><td data-status="${f.status}">${esc(f.status.replace('_', ' '))}</td></tr>`).join('');
  const pos = b.especificacoes.positions.map((p) => `<tr><td>${esc(p.id)}</td><td>${esc(p.desktop ?? 'a especificar')}</td><td>${p.slotLimit ?? 'não configurado'}</td><td>${p.maxWeightKB ?? '—'}</td><td>${p.minContractDays ?? '—'}</td></tr>`).join('');
  return `<article class="mediakit"><h1>Mídia kit Loyalty News</h1><p>Gerado em ${esc(kit.generatedAt)}. ${esc(kit.methodologyNote)}</p>
<section data-block="cobertura"><h2>1. Cobertura</h2>${b.cobertura.emptyState ? `<p>${esc(b.cobertura.emptyState)}</p>` : ''}<ul>${b.cobertura.metrics.map(metricLine).join('')}</ul></section>
<section data-block="audiencia"><h2>2. Audiência por canal</h2>${b.audiencia.emptyState ? `<p>${esc(b.audiencia.emptyState)}</p>` : ''}<ul>${b.audiencia.metrics.map(metricLine).join('')}</ul><p>${esc(b.audiencia.note)}</p></section>
<section data-block="decisores"><h2>3. Decisores</h2><p>${esc(b.decisores.emptyState)}</p></section>
<section data-block="tese"><h2>4. Tese</h2><p>${esc(b.tese.text)}</p></section>
<section data-block="especificacoes"><h2>5. Especificações e posições</h2><table><thead><tr><th>Posição</th><th>Desktop</th><th>Cotas</th><th>Peso máx. KB</th><th>Contrato mín. (dias)</th></tr></thead><tbody>${pos}</tbody></table><p>${esc(b.especificacoes.mobileNote)}</p></section>
<section data-block="catalogo"><h2>6. Catálogo (${b.catalogo.total} formatos)</h2><p>${esc(b.catalogo.disclaimer)}</p><table><thead><tr><th>Família</th><th>Produto</th><th>Referência</th><th>Escopo</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></section>
<section data-block="contratacao"><h2>7. Contratação</h2><ol>${b.contratacao.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>
<section data-block="formulario"><h2>8. Fale com o comercial</h2><ul>${b.formulario.fields.map((f) => `<li>${esc(f.name)}${f.required ? ' *' : ''}</li>`).join('')}</ul><p>O opt-in da newsletter é separado do contato comercial.</p></section></article>`;
}

// ---------- modelo de audiência para o portal ----------
/** Mesma forma de MetricValue do portal (apps/web/app/(portal)/_lib/types.ts). Sem coleta: value null e state 'unavailable'. */
export interface PortalMetric { /** Chave da métrica (ex.: articles_published_30d); usada pela cobertura. */ id?: string; label: string; value: string | null; state: 'ok' | 'unavailable' | 'stale'; source: string; window?: string; collectedAt?: string }
export interface PortalAudience { realtime: PortalMetric[]; historical: PortalMetric[] }

const SOURCE_NAME: Record<string, string> = { ga4_realtime: 'GA4 (tempo real)', ga4_report: 'GA4', esp: 'ESP · The Loyal', linkedin: 'LinkedIn', cms: 'CMS' };
const dateBR = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));

function toPortalMetric(s: MetricSlot, store: MetricStore, now: string, withId: boolean): PortalMetric {
  const r = store.get({ source: s.source, metric: s.metric }, now, s.klass);
  const have = r.value !== null && r.status !== 'unavailable';
  const m: PortalMetric = {
    ...(withId ? { id: s.metric } : {}),
    label: s.label,
    value: have ? r.value!.toLocaleString('pt-BR') : null,
    state: !have ? 'unavailable' : r.status === 'stale' ? 'stale' : 'ok',
    source: SOURCE_NAME[s.source] ?? s.source,
  };
  if (have) {
    m.window = s.klass === 'realtime' ? 'últimos 30 min' : `${dateBR(r.period_start!)} a ${dateBR(r.period_end!)}`;
    m.collectedAt = r.fetched_at!;
  }
  return m;
}

/** Audiência do mídia kit no formato do portal. Cada número traz origem, janela e horário da coleta; sem coleta, "indisponível". */
export function portalAudience(store: MetricStore, now: string): PortalAudience {
  const out: PortalAudience = { realtime: [], historical: [] };
  for (const s of METRIC_SLOTS.filter((x) => x.block === 'audiencia')) out[s.klass === 'realtime' ? 'realtime' : 'historical'].push(toPortalMetric(s, store, now, false));
  return out;
}

/**
 * Cobertura (CMS) no formato do portal: matérias publicadas em 30 e 90 dias e eventos futuros. Só entra o que foi COLETADO (origem, janela e
 * horário); sem coleta, "indisponível". Quem alimenta o MetricStore deve contar apenas conteúdo real (nunca seed/demonstração).
 */
export function portalCoverage(store: MetricStore, now: string): PortalMetric[] {
  return METRIC_SLOTS.filter((x) => x.block === 'cobertura').map((s) => toPortalMetric(s, store, now, true));
}
