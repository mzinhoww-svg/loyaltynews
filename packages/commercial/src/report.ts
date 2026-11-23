// Relatório do anunciante por campanha. Regras (PM): impressões VISÍVEIS e cliques VÁLIDOS contados de verdade, com origem, janela e data;
// NUNCA estimados, extrapolados ou preenchidos com zero; exporta CSV; sem cobrança nem faturamento (nenhum campo de preço/valor aqui).
// Puro (sem I/O): recebe as linhas diárias já gravadas pelo ad server (ad_delivery_daily) e devolve o relatório e o CSV.
import type { Campaign } from './campaigns';
import { auditabilityOf, campaignPeriodMs, type DeliveryAudit } from './audit';
import { POSITIONS, type BannerPosition, type Reservation } from './inventory';
import type { Creative } from './rotation';

export const REPORT_METHODOLOGY_VERSION = 'rel-1';
export const MAX_WINDOW_DAYS = 366;

/** Uma linha de ad_delivery_daily: contadores de UM criativo em UM dia (dia de calendário em America/Sao_Paulo). */
export interface DeliveryRow {
  creativeId: string;
  day: string; // YYYY-MM-DD
  served: number; visible: number; clicks: number;
  ignoredBotInternal: number; refreshSuppressed: number;
  /** Quando a linha foi atualizada pela última vez (ISO): é a "data" do dado. */
  updatedAt: string;
}

export class ReportError extends Error {
  code: 'INVALID_WINDOW';
  constructor(code: 'INVALID_WINDOW', msg: string) { super(msg); this.code = code; }
}

export interface ReportInput {
  campaign: Campaign;
  advertiserName: string | null;
  creatives: readonly Creative[];
  reservations: readonly Reservation[];
  delivery: readonly DeliveryRow[];
  audit: DeliveryAudit;
  /** ISO com offset: instante da geração. */
  now: string;
  window?: { from?: string; to?: string };
  positions?: readonly BannerPosition[];
}

export interface ReportRow { day: string; creativeId: string; positionId: string; served: number; visible: number; clicks: number; visibleRate: number | null; ctr: number | null; updatedAt: string }
export interface ReportTotals { served: number; visible: number; clicks: number; visibleRate: number | null; ctr: number | null }
export interface DataIssue { creativeId: string; day: string; reason: string }

export interface CampaignReport {
  generatedAt: string;
  methodologyVersion: typeof REPORT_METHODOLOGY_VERSION;
  campaign: { id: string; name: string; status: string; startDate: string; endDate: string };
  advertiser: { id: string; name: string | null };
  positions: { positionId: string; name: string; dimension: string | null; reservations: { id: string; startDate: string; endDate: string; status: string }[]; approvedCreatives: number }[];
  approvedCreatives: { id: string; positionId: string; width: number | null; height: number | null; altText: string | null }[];
  pendingCreatives: number;
  /** Origem do dado. */
  source: { name: string; table: string };
  /** Janela pedida (já recortada ao período da campanha) e janela com dado de fato. */
  window: { from: string; to: string; effective: { from: string; to: string } | null };
  /** Atualização mais recente entre as linhas contadas; null sem dado. */
  updatedAt: string | null;
  /** null = sem nenhuma linha de entrega na janela. Nunca zero inventado. */
  totals: ReportTotals | null;
  /** O que o ad server recebeu e NÃO contou (informativo). */
  excluded: { botOrInternal: number; refreshSuppressed: number } | null;
  daily: { day: string; served: number; visible: number; clicks: number; visibleRate: number | null; ctr: number | null }[];
  byCreative: { creativeId: string; positionId: string; approved: boolean; served: number; visible: number; clicks: number; visibleRate: number | null; ctr: number | null }[];
  byPosition: { positionId: string; served: number; visible: number; clicks: number; visibleRate: number | null; ctr: number | null }[];
  rows: ReportRow[];
  /** Linhas descartadas por inconsistência (nunca entram nos números). */
  dataIssues: DataIssue[];
  auditability: { auditable: boolean; lowerBound: boolean; gaps: ReturnType<DeliveryAudit['list']>; note: string | null };
  /** Sempre false: este relatório não estima, não extrapola e não completa dias faltantes. */
  estimated: false;
  emptyState: string | null;
  notes: string[];
  definitions: string[];
}

const DAY_MS = 86_400_000;
const parseDay = (d: string): number => Date.parse(`${d}T00:00:00Z`);
/** Data de calendário REAL: o motor aceita 2026-02-30 como 2 de março, então confere a ida e volta. */
const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseDay(d)) && new Date(parseDay(d)).toISOString().slice(0, 10) === d;
const rate = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1e6) / 1e6 : null);
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const spDate = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const DEFINITIONS = [
  'Impressão servida: anúncio entregue ao navegador, contada uma vez por visualização de página e posição (sem inflar por auto-refresh).',
  'Impressão visível: pelo menos 50% da área do anúncio por pelo menos 1 segundo contínuo, com a aba visível; conta uma vez por impressão servida.',
  'Clique válido: clique em impressão servida real, contado uma vez por impressão.',
  'Taxa de visibilidade = impressões visíveis ÷ impressões servidas. CTR = cliques válidos ÷ impressões servidas.',
  'Fora da contagem: bots, tráfego interno e auto-refresh (aparecem só como informação).',
  'Nenhum número é estimado ou extrapolado; dias sem registro ficam de fora (não valem zero).',
];

export function buildCampaignReport(i: ReportInput): CampaignReport {
  const c = i.campaign;
  const positionsSpec = i.positions ?? POSITIONS;

  // ---- janela: pedida, recortada ao período da campanha ----
  const reqFrom = i.window?.from ?? c.startDate; const reqTo = i.window?.to ?? c.endDate;
  if (!isDay(reqFrom) || !isDay(reqTo) || parseDay(reqFrom) > parseDay(reqTo)) throw new ReportError('INVALID_WINDOW', 'Janela inválida (datas AAAA-MM-DD, início ≤ fim).');
  const from = reqFrom < c.startDate ? c.startDate : reqFrom;
  const to = reqTo > c.endDate ? c.endDate : reqTo;
  if (parseDay(from) > parseDay(to)) throw new ReportError('INVALID_WINDOW', 'A janela não toca o período da campanha.');
  if ((parseDay(to) - parseDay(from)) / DAY_MS + 1 > MAX_WINDOW_DAYS) throw new ReportError('INVALID_WINDOW', `Janela máxima de ${MAX_WINDOW_DAYS} dias.`);

  // ---- criativos e posições da campanha ----
  const own = i.creatives.filter((x) => x.campaignId === c.id);
  const ownIds = new Map(own.map((x) => [x.id, x]));
  const approved = own.filter((x) => x.approved);
  const resv = i.reservations.filter((r) => r.campaignId === c.id && r.status !== 'cancelled');
  const posIds = [...new Set([...(c.positionId ? [c.positionId] : []), ...own.map((x) => x.positionId), ...resv.map((r) => r.positionId)])].sort();
  const positions = posIds.map((id) => {
    const spec = positionsSpec.find((p) => p.id === id);
    return {
      positionId: id, name: spec?.name ?? id, dimension: spec?.desktop ?? null,
      reservations: resv.filter((r) => r.positionId === id).map((r) => ({ id: r.id, startDate: r.startDate, endDate: r.endDate, status: r.status })),
      approvedCreatives: approved.filter((x) => x.positionId === id).length,
    };
  });

  // ---- linhas válidas (nunca entram números impossíveis) ----
  const issues: DataIssue[] = [];
  const seen = new Set<string>();
  const valid: DeliveryRow[] = [];
  const sorted = [...i.delivery].sort((a, b) => (a.day + a.creativeId).localeCompare(b.day + b.creativeId));
  for (const r of sorted) {
    if (!ownIds.has(r.creativeId)) continue; // outra campanha
    if (!isDay(r.day)) { issues.push({ creativeId: r.creativeId, day: String(r.day), reason: 'dia inválido' }); continue; }
    if (r.day < from || r.day > to) continue; // fora da janela
    const key = `${r.creativeId}|${r.day}`;
    if (!isCount(r.served) || !isCount(r.visible) || !isCount(r.clicks) || !isCount(r.ignoredBotInternal) || !isCount(r.refreshSuppressed)) { issues.push({ creativeId: r.creativeId, day: r.day, reason: 'contador inválido (negativo ou não inteiro)' }); continue; }
    if (r.visible > r.served || r.clicks > r.served) { issues.push({ creativeId: r.creativeId, day: r.day, reason: 'visíveis ou cliques maiores que as servidas' }); continue; }
    if (Number.isNaN(Date.parse(r.updatedAt))) { issues.push({ creativeId: r.creativeId, day: r.day, reason: 'data de atualização inválida' }); continue; }
    if (seen.has(key)) { issues.push({ creativeId: r.creativeId, day: r.day, reason: 'linha duplicada para o mesmo criativo e dia' }); continue; }
    seen.add(key); valid.push(r);
  }

  const sum = (rs: readonly DeliveryRow[]) => rs.reduce((t, r) => ({ served: t.served + r.served, visible: t.visible + r.visible, clicks: t.clicks + r.clicks }), { served: 0, visible: 0, clicks: 0 });
  const withRates = <T extends { served: number; visible: number; clicks: number }>(t: T) => ({ ...t, visibleRate: rate(t.visible, t.served), ctr: rate(t.clicks, t.served) });

  const has = valid.length > 0;
  const rows: ReportRow[] = valid.map((r) => ({ day: r.day, creativeId: r.creativeId, positionId: ownIds.get(r.creativeId)!.positionId, ...withRates({ served: r.served, visible: r.visible, clicks: r.clicks }), updatedAt: r.updatedAt }));
  const group = <K extends string>(key: (r: DeliveryRow) => K) => {
    const m = new Map<K, DeliveryRow[]>();
    for (const r of valid) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const days = valid.map((r) => r.day).sort();
  const gapInfo = auditabilityOf(i.audit, ...campaignPeriodMs(from, to));
  const today = spDate(i.now);

  const notes: string[] = [];
  if (!gapInfo.auditable) notes.push(gapInfo.note!);
  if (today >= from && today <= to) notes.push('O dia de hoje ainda está em coleta: os números de hoje podem aumentar.');
  if (issues.length) notes.push(`${issues.length} linha(s) de entrega com inconsistência foram descartadas e não entram nos números.`);
  const notActive = ['draft', 'reserved', 'approved'].includes(c.status);

  return {
    generatedAt: i.now, methodologyVersion: REPORT_METHODOLOGY_VERSION,
    campaign: { id: c.id, name: c.name, status: c.status, startDate: c.startDate, endDate: c.endDate },
    advertiser: { id: c.accountId, name: i.advertiserName },
    positions,
    approvedCreatives: approved.map((x) => ({ id: x.id, positionId: x.positionId, width: x.asset?.width ?? null, height: x.asset?.height ?? null, altText: x.altText ?? null })),
    pendingCreatives: own.length - approved.length,
    source: { name: 'Servidor de anúncios do Loyalty News (contagem própria, com filtro de bots, tráfego interno e auto-refresh)', table: 'ad_delivery_daily' },
    window: { from, to, effective: has ? { from: days[0]!, to: days[days.length - 1]! } : null },
    updatedAt: has ? valid.map((r) => r.updatedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)! : null,
    totals: has ? withRates(sum(valid)) : null,
    excluded: has ? { botOrInternal: valid.reduce((t, r) => t + r.ignoredBotInternal, 0), refreshSuppressed: valid.reduce((t, r) => t + r.refreshSuppressed, 0) } : null,
    daily: group((r) => r.day).map(([day, rs]) => ({ day, ...withRates(sum(rs)) })),
    byCreative: group((r) => r.creativeId).map(([creativeId, rs]) => ({ creativeId, positionId: ownIds.get(creativeId)!.positionId, approved: ownIds.get(creativeId)!.approved, ...withRates(sum(rs)) })),
    byPosition: group((r) => ownIds.get(r.creativeId)!.positionId).map(([positionId, rs]) => ({ positionId, ...withRates(sum(rs)) })),
    rows, dataIssues: issues,
    auditability: { auditable: gapInfo.auditable, lowerBound: !gapInfo.auditable, gaps: gapInfo.gaps, note: gapInfo.note },
    estimated: false,
    emptyState: has ? null : notActive ? 'A campanha ainda não foi ativada: não há entrega registrada.' : 'Sem entrega registrada na janela.',
    notes, definitions: DEFINITIONS,
  };
}

// ---------- CSV ----------
const BOM = '﻿';
const EOL = '\r\n';
/**
 * Célula CSV segura: aspas duplicadas quando há vírgula, aspas, ponto e vírgula ou quebra de linha; e proteção contra injeção de fórmula
 * (texto começando por = + - @ tab ou CR ganha um apóstrofo, para o Excel/Sheets não executar). Número e nulo não são texto.
 */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'sim' : 'nao';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (cells: (string | number | boolean | null | undefined)[]) => cells.map(csvCell).join(',');

export const DAILY_CSV_COLUMNS = ['campanha_id', 'campanha', 'anunciante', 'data', 'posicao', 'criativo_id', 'impressoes_servidas', 'impressoes_visiveis', 'cliques_validos', 'taxa_visibilidade', 'ctr', 'origem', 'coletado_em', 'periodo_auditavel'] as const;

/** CSV diário: uma linha por criativo e dia COM registro. Sem linha para dia sem dado. Taxas vazias quando não há servidas. */
export function reportDailyCsv(r: CampaignReport): string {
  const out = [line([...DAILY_CSV_COLUMNS])];
  for (const x of r.rows) {
    out.push(line([r.campaign.id, r.campaign.name, r.advertiser.name, x.day, x.positionId, x.creativeId, x.served, x.visible, x.clicks, x.visibleRate, x.ctr, r.source.name, x.updatedAt, r.auditability.auditable]));
  }
  return BOM + out.join(EOL) + EOL;
}

/** CSV de resumo: campo,valor. Traz janela, origem, atualização, auditabilidade e as definições. */
export function reportSummaryCsv(r: CampaignReport): string {
  const t = r.totals;
  const kv: [string, string | number | boolean | null][] = [
    ['campanha_id', r.campaign.id], ['campanha', r.campaign.name], ['anunciante', r.advertiser.name], ['status', r.campaign.status],
    ['periodo_campanha_inicio', r.campaign.startDate], ['periodo_campanha_fim', r.campaign.endDate],
    ['janela_inicio', r.window.from], ['janela_fim', r.window.to],
    ['janela_com_dado_inicio', r.window.effective?.from ?? null], ['janela_com_dado_fim', r.window.effective?.to ?? null],
    ['posicoes', r.positions.map((p) => p.positionId).join(' | ')], ['criativos_aprovados', r.approvedCreatives.length],
    ['impressoes_servidas', t?.served ?? null], ['impressoes_visiveis', t?.visible ?? null], ['cliques_validos', t?.clicks ?? null],
    ['taxa_visibilidade', t?.visibleRate ?? null], ['ctr', t?.ctr ?? null],
    ['fora_da_contagem_bot_ou_interno', r.excluded?.botOrInternal ?? null], ['fora_da_contagem_auto_refresh', r.excluded?.refreshSuppressed ?? null],
    ['origem', r.source.name], ['atualizado_em', r.updatedAt], ['gerado_em', r.generatedAt],
    ['periodo_auditavel', r.auditability.auditable], ['aviso_auditoria', r.auditability.note],
    ['estimado', false], ['sem_dado', r.emptyState],
    ...r.definitions.map((d): [string, string] => ['definicao', d]),
  ];
  return BOM + [line(['campo', 'valor']), ...kv.map(([k, v]) => line([k, v]))].join(EOL) + EOL;
}

export type ReportCsvKind = 'diario' | 'resumo';
export function reportCsv(r: CampaignReport, kind: ReportCsvKind): { filename: string; contentType: string; csv: string } {
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'campanha';
  return {
    filename: `relatorio-${kind}-${safe(r.campaign.id)}-${r.window.from}-${r.window.to}.csv`,
    contentType: 'text/csv; charset=utf-8',
    csv: kind === 'diario' ? reportDailyCsv(r) : reportSummaryCsv(r),
  };
}
