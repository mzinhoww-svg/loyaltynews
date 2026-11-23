// Relatório do ANUNCIANTE: agrega as campanhas dele numa janela. Mesmas regras do relatório de campanha (report.ts): só número CONTADO
// (impressões servidas e visíveis, cliques válidos), com origem, janela e data; nunca estimado; sem linha de entrega = traço (nunca zero);
// linhas inconsistentes descartadas e listadas; "não auditável" quando houve perda de dedupe; exporta CSV; sem cobrança nem faturamento.
import type { Campaign } from './campaigns';
import { auditabilityOf, campaignPeriodMs, type DeliveryAudit } from './audit';
import type { BannerPosition, Reservation } from './inventory';
import { ReportError, buildCampaignReport, reportInternals, type CampaignReport, type DataIssue, type DeliveryRow, type ReportRow, type ReportTotals } from './report';
import type { Creative } from './rotation';

const { DAY_MS, parseDay, isDay, rate, spDate, line, BOM, EOL } = reportInternals;

export interface AdvertiserReportInput {
  account: { id: string; name: string };
  campaigns: readonly Campaign[];
  creatives: readonly Creative[];
  reservations: readonly Reservation[];
  delivery: readonly DeliveryRow[];
  audit: DeliveryAudit;
  now: string;
  window?: { from?: string; to?: string };
  positions?: readonly BannerPosition[];
}

export interface AdvertiserReport {
  generatedAt: string;
  methodologyVersion: CampaignReport['methodologyVersion'];
  advertiser: { id: string; name: string };
  window: { from: string; to: string; effective: { from: string; to: string } | null };
  /** Campanhas do anunciante que tocam a janela, cada uma com o seu total (null = sem entrega registrada). */
  campaigns: { id: string; name: string; status: string; startDate: string; endDate: string; positions: string[]; totals: ReportTotals | null; updatedAt: string | null }[];
  totals: ReportTotals | null;
  excluded: { botOrInternal: number; refreshSuppressed: number } | null;
  updatedAt: string | null;
  source: CampaignReport['source'];
  daily: { day: string; served: number; visible: number; clicks: number; visibleRate: number | null; ctr: number | null }[];
  rows: (ReportRow & { campaignId: string; campaignName: string })[];
  dataIssues: (DataIssue & { campaignId: string })[];
  auditability: { auditable: boolean; lowerBound: boolean; gaps: ReturnType<DeliveryAudit['list']>; note: string | null };
  /** Sempre false: nada é estimado, extrapolado nem completado. */
  estimated: false;
  emptyState: string | null;
  notes: string[];
  definitions: string[];
}

export function buildAdvertiserReport(i: AdvertiserReportInput): AdvertiserReport {
  const own = i.campaigns.filter((c) => c.accountId === i.account.id);
  const today = spDate(i.now);

  // ---- janela: pedida, ou o intervalo das campanhas (no máximo os últimos 366 dias) ----
  let defFrom = today; let defTo = today;
  if (own.length) {
    defTo = own.map((c) => c.endDate).sort().at(-1)!;
    defFrom = own.map((c) => c.startDate).sort()[0]!;
    const floor = new Date(parseDay(defTo) - 365 * DAY_MS).toISOString().slice(0, 10);
    if (defFrom < floor) defFrom = floor;
  }
  const from = i.window?.from ?? defFrom; const to = i.window?.to ?? defTo;
  if (!isDay(from) || !isDay(to) || parseDay(from) > parseDay(to)) throw new ReportError('INVALID_WINDOW', 'Janela inválida (datas AAAA-MM-DD, início ≤ fim).');
  if ((parseDay(to) - parseDay(from)) / DAY_MS + 1 > 366) throw new ReportError('INVALID_WINDOW', 'Janela máxima de 366 dias.');

  // ---- uma campanha por vez, só as que tocam a janela ----
  const touching = own.filter((c) => c.startDate <= to && c.endDate >= from).sort((a, b) => (a.startDate + a.id).localeCompare(b.startDate + b.id));
  const reports = touching.map((c) => buildCampaignReport({
    campaign: c, advertiserName: i.account.name, creatives: i.creatives, reservations: i.reservations, delivery: i.delivery,
    audit: i.audit, now: i.now, window: { from, to }, positions: i.positions,
  }));

  const rows = reports.flatMap((r) => r.rows.map((x) => ({ ...x, campaignId: r.campaign.id, campaignName: r.campaign.name })));
  const has = rows.length > 0;
  const sum = (rs: readonly { served: number; visible: number; clicks: number }[]) => rs.reduce((t, r) => ({ served: t.served + r.served, visible: t.visible + r.visible, clicks: t.clicks + r.clicks }), { served: 0, visible: 0, clicks: 0 });
  const withRates = <T extends { served: number; visible: number; clicks: number }>(t: T) => ({ ...t, visibleRate: rate(t.visible, t.served), ctr: rate(t.clicks, t.served) });

  const byDay = new Map<string, ReportRow[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  const days = rows.map((r) => r.day).sort();
  const gap = auditabilityOf(i.audit, ...campaignPeriodMs(from, to));
  const dataIssues = reports.flatMap((r) => r.dataIssues.map((d) => ({ ...d, campaignId: r.campaign.id })));

  const notes: string[] = [];
  if (!gap.auditable) notes.push(gap.note!);
  if (today >= from && today <= to) notes.push('O dia de hoje ainda está em coleta: os números de hoje podem aumentar.');
  if (dataIssues.length) notes.push(`${dataIssues.length} linha(s) de entrega com inconsistência foram descartadas e não entram nos números.`);
  if (!i.window?.from && !i.window?.to && own.length && from > own.map((c) => c.startDate).sort()[0]!) notes.push('Janela padrão limitada aos últimos 366 dias das campanhas.');

  return {
    generatedAt: i.now, methodologyVersion: reports[0]?.methodologyVersion ?? 'rel-1',
    advertiser: { id: i.account.id, name: i.account.name },
    window: { from, to, effective: has ? { from: days[0]!, to: days[days.length - 1]! } : null },
    campaigns: reports.map((r) => ({ id: r.campaign.id, name: r.campaign.name, status: r.campaign.status, startDate: r.campaign.startDate, endDate: r.campaign.endDate, positions: r.positions.map((p) => p.positionId), totals: r.totals, updatedAt: r.updatedAt })),
    totals: has ? withRates(sum(rows)) : null,
    excluded: has ? { botOrInternal: reports.reduce((t, r) => t + (r.excluded?.botOrInternal ?? 0), 0), refreshSuppressed: reports.reduce((t, r) => t + (r.excluded?.refreshSuppressed ?? 0), 0) } : null,
    updatedAt: has ? reports.flatMap((r) => (r.updatedAt ? [r.updatedAt] : [])).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)! : null,
    source: reports[0]?.source ?? { name: 'Servidor de anúncios do Loyalty News (contagem própria, com filtro de bots, tráfego interno e auto-refresh)', table: 'ad_delivery_daily' },
    daily: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, rs]) => ({ day, ...withRates(sum(rs)) })),
    rows, dataIssues,
    auditability: { auditable: gap.auditable, lowerBound: !gap.auditable, gaps: gap.gaps, note: gap.note },
    estimated: false,
    emptyState: !own.length ? 'O anunciante ainda não tem campanhas.' : !touching.length ? 'Nenhuma campanha do anunciante toca a janela.' : has ? null : 'Sem entrega registrada na janela.',
    notes,
    definitions: reports[0]?.definitions ?? buildCampaignReport({ campaign: { id: '-', name: '-', accountId: i.account.id, opportunityId: null, formatId: '-', positionIds: [], positionId: null, startDate: from, endDate: to, status: 'draft', reservationIds: [], sponsoredLabel: true, history: [] }, advertiserName: null, creatives: [], reservations: [], delivery: [], audit: i.audit, now: i.now, window: { from, to } }).definitions,
  };
}

// ---------- CSV ----------
export const ADVERTISER_DAILY_CSV_COLUMNS = ['anunciante_id', 'anunciante', 'campanha_id', 'campanha', 'data', 'posicao', 'criativo_id', 'impressoes_servidas', 'impressoes_visiveis', 'cliques_validos', 'taxa_visibilidade', 'ctr', 'origem', 'coletado_em', 'periodo_auditavel'] as const;

/** CSV diário: uma linha por campanha, criativo e dia COM registro. Sem linha para dia sem dado; taxas vazias quando não há servidas. */
export function advertiserDailyCsv(r: AdvertiserReport): string {
  const out = [line([...ADVERTISER_DAILY_CSV_COLUMNS])];
  for (const x of r.rows) {
    out.push(line([r.advertiser.id, r.advertiser.name, x.campaignId, x.campaignName, x.day, x.positionId, x.creativeId, x.served, x.visible, x.clicks, x.visibleRate, x.ctr, r.source.name, x.updatedAt, r.auditability.auditable]));
  }
  return BOM + out.join(EOL) + EOL;
}

/** CSV de resumo: campo,valor, com uma sequência de linhas por campanha. */
export function advertiserSummaryCsv(r: AdvertiserReport): string {
  const t = r.totals;
  const kv: [string, string | number | boolean | null][] = [
    ['anunciante_id', r.advertiser.id], ['anunciante', r.advertiser.name],
    ['janela_inicio', r.window.from], ['janela_fim', r.window.to],
    ['janela_com_dado_inicio', r.window.effective?.from ?? null], ['janela_com_dado_fim', r.window.effective?.to ?? null],
    ['campanhas_na_janela', r.campaigns.length],
    ['impressoes_servidas', t?.served ?? null], ['impressoes_visiveis', t?.visible ?? null], ['cliques_validos', t?.clicks ?? null],
    ['taxa_visibilidade', t?.visibleRate ?? null], ['ctr', t?.ctr ?? null],
    ['fora_da_contagem_bot_ou_interno', r.excluded?.botOrInternal ?? null], ['fora_da_contagem_auto_refresh', r.excluded?.refreshSuppressed ?? null],
    ['origem', r.source.name], ['atualizado_em', r.updatedAt], ['gerado_em', r.generatedAt],
    ['periodo_auditavel', r.auditability.auditable], ['aviso_auditoria', r.auditability.note],
    ['estimado', false], ['sem_dado', r.emptyState],
  ];
  for (const c of r.campaigns) {
    kv.push(['campanha', `${c.id} | ${c.name} | ${c.status} | ${c.startDate} a ${c.endDate} | ${c.positions.join(', ')}`]);
    kv.push([`campanha_${c.id}_impressoes_servidas`, c.totals?.served ?? null], [`campanha_${c.id}_impressoes_visiveis`, c.totals?.visible ?? null], [`campanha_${c.id}_cliques_validos`, c.totals?.clicks ?? null]);
  }
  for (const d of r.definitions) kv.push(['definicao', d]);
  return BOM + [line(['campo', 'valor']), ...kv.map(([k, v]) => line([k, v]))].join(EOL) + EOL;
}

export function advertiserCsv(r: AdvertiserReport, kind: 'diario' | 'resumo'): { filename: string; contentType: string; csv: string } {
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'anunciante';
  return {
    filename: `relatorio-anunciante-${kind}-${safe(r.advertiser.id)}-${r.window.from}-${r.window.to}.csv`,
    contentType: 'text/csv; charset=utf-8',
    csv: kind === 'diario' ? advertiserDailyCsv(r) : advertiserSummaryCsv(r),
  };
}
