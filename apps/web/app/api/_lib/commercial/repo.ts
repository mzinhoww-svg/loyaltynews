// Repositório do módulo comercial: hidrata o contexto do domínio (@ln/commercial) a partir do PostgreSQL
// (schema em @ln/db/schema/commercial.ts) pela API oficial `load()`/`snapshot()` e persiste só o que o handler
// mudou (diferença linha a linha). Leituras: sem lock. Escritas: uma transação com lock consultivo
// (pg_advisory_xact_lock), então reservas e transições se serializam. Carrega as tabelas inteiras por requisição
// (volume pequeno; otimizar depois). O ad server público NÃO passa por aqui: ver ads.ts (Redis).
import { and, eq, getTableColumns, gte, inArray, like, lte, not, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  AdServer, CampaignBook, CATALOG, Crm, ImpressionLedger, InventoryBook, MetricStore, MAX_WINDOW_DAYS, POSITIONS, SNAPSHOT_VERSION, campaignPeriodMs, catalogFor, resolveFormatStatus,
  type Account, type BannerPosition, type Contact, type ContactBasis, type Campaign, type CommercialFormat, type CommercialState, type Creative, type DeliveryCounters,
  type DeliveryRow, type Lead, type MetricRecord, type Opportunity, type Reservation, type Takeover,
} from '@ln/commercial';
import { flagEnvFrom, type FlagEnv } from '@ln/contracts';
import { schema } from '@ln/db';
import { HttpError } from '../http';
import { loadGaps, loadGapsInto } from './gaps';
import type { Db } from '@ln/auth';

export const COMMERCIAL_LOCK = 7_010_001;

type Row = Record<string, unknown> & { id: string };
export interface Rows {
  accounts: Row[]; contacts: Row[]; leads: Row[]; opportunities: Row[]; history: Row[]; campaigns: Row[]; campaignPositions: Row[];
  reservations: Row[]; takeovers: Row[]; creatives: Row[]; metrics: Row[];
}
export interface Hydrated {
  state: CommercialState;
  before: Rows;
}

const seeded = new WeakSet<object>();
export async function seedCommercial(db: Db): Promise<void> {
  if (seeded.has(db)) return;
  const formats = CATALOG.map((f) => ({
    id: f.id, secao: f.section, nome: f.name, referenciaBrl: f.referenceText, escopo: f.scope, disponibilidade: f.status,
    precoTipo: f.priceType, precoValorBrl: f.fromBRL === null ? null : String(f.fromBRL), unidade: f.unit,
    taxaPct: f.feePct === null ? null : String(f.feePct),
    motivoDisponibilidade: f.statusReason || 'Sem capacidade operacional declarada.', fonteLinha: f.sourceLine,
  }));
  await db.insert(schema.adFormats).values(formats).onConflictDoNothing();
  const slots = POSITIONS.map((p) => ({
    id: p.id, posicao: p.id as (typeof schema.slotPosicao.enumValues)[number], formatoId: p.formatId,
    dimensaoDesktop: p.desktop ?? 'parametrizavel', variantesMobile: p.mobile, limiteCotas: p.slotLimit,
    pesoMaxKb: p.maxWeightKB, contratoMinimoDias: p.minContractDays, tiposPermitidos: p.allowedTypes,
  }));
  await db.insert(schema.adSlots).values(slots).onConflictDoNothing();
  seeded.add(db);
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));
const iso = (d: Date): string => d.toISOString();
const ZERO = (): DeliveryCounters => ({ served: 0, visible: 0, clicks: 0, ignoredBotOrInternal: 0, refreshSuppressed: 0 });

/**
 * O seed grava o estado que o CÓDIGO dava ao formato naquele momento (CATALOG, sem liberação de ambiente) e o motivo padrão do código.
 * Um 'indisponivel' gravado com exatamente esse motivo é cópia do código, não uma retirada de alguém: sem isso, os 14 formatos de canal
 * desligado ficariam 'indisponivel' para sempre mesmo depois da liberação do proprietário (DP-54). Uma retirada deliberada grava o próprio
 * motivo (SQL de operação) e continua rebaixando; se o texto padrão do código mudar um dia, a linha antiga passa a valer como retirada
 * (falha fechada).
 */
const seedPadrao = (id: string, r: { disponibilidade: string; motivoDisponibilidade: string }): boolean =>
  r.disponibilidade === 'indisponivel' && r.motivoDisponibilidade === (CATALOG.find((x) => x.id === id)?.statusReason || 'Sem capacidade operacional declarada.');

/** Catálogo: o código define o formato; o banco (ajustável por operação) manda no estado de disponibilidade. */
async function loadCatalog(db: Db, env: FlagEnv | null): Promise<CommercialFormat[]> {
  const byFmt = new Map((await db.select().from(schema.adFormats)).map((f) => [f.id, f]));
  return catalogFor(env).map((f) => {
    const r = byFmt.get(f.id);
    const gravado = r && !seedPadrao(f.id, r) ? { status: r.disponibilidade, reason: r.motivoDisponibilidade } : undefined;
    return { ...f, ...resolveFormatStatus(f, gravado) };
  });
}

/** Criativos do ad server com `campaignActive` derivado do status da campanha. */
export async function loadCreatives(db: Db): Promise<Creative[]> {
  const [crs, camps, accs] = await Promise.all([
    db.select().from(schema.adCreatives),
    db.select({ id: schema.campaigns.id, status: schema.campaigns.status, contaId: schema.campaigns.contaId }).from(schema.campaigns),
    db.select({ id: schema.crmAccounts.id, nome: schema.crmAccounts.nome }).from(schema.crmAccounts),
  ]);
  const active = new Set(camps.filter((c) => c.status === 'active').map((c) => c.id));
  const accountOfCampaign = new Map(camps.map((c) => [c.id, c.contaId]));
  const accountName = new Map(accs.map((a) => [a.id, a.nome]));
  return crs.map((c): Creative => {
    const complete = c.arquivoRef && c.arquivoMime && c.largura && c.altura && c.tamanhoKb && c.arquivoSha256;
    const advertiser = accountName.get(accountOfCampaign.get(c.campanhaId) ?? '');
    return {
      id: c.id, campaignId: c.campanhaId, positionId: c.slotId, weight: c.peso, startDate: c.inicio, endDate: c.fim,
      approved: c.aprovado, campaignActive: active.has(c.campanhaId), label: 'publicidade',
      // criativo "real" = arquivo MEDIDO NO SERVIDOR + texto alternativo + anunciante (nome da conta da campanha) + destino https; sem isso o domínio não o serve
      ...(complete ? { asset: { key: c.arquivoRef!, mime: c.arquivoMime as 'image/jpeg' | 'image/png' | 'image/gif', width: c.largura!, height: c.altura!, sizeKB: c.tamanhoKb!, sha256: c.arquivoSha256! } } : {}),
      ...(c.textoAlternativo ? { altText: c.textoAlternativo } : {}),
      ...(advertiser ? { advertiserName: advertiser } : {}),
      ...(c.destinoUrl ? { destinationUrl: c.destinoUrl } : {}),
    };
  });
}

/** Marcas do seed de staging (apps/workers/src/seed-staging.ts; um teste confere que não divergem). Métrica comercial só conta conteúdo REAL. */
export const SEED_ID_PREFIX = 'seed-stg-';
export const SEED_DEMO_LABEL = '[DEMO';

const DIA = 86_400_000;
const CMS_METHODOLOGY = 'cms-1';

/**
 * Cobertura do mídia kit (fonte `cms`): matérias publicadas nos últimos 30/90 dias e eventos futuros aprovados, contando SÓ conteúdo real: fora o seed de
 * staging (id `seed-stg-*` ou rótulo `[DEMO…`), rascunhos e o que não é público. Sem contagem real (zero), a métrica NÃO existe ("—" no portal): nunca um zero
 * que pareça medição. Período e `fetched_at` reais (o instante da contagem).
 */
export async function cmsCoverageMetrics(db: Db, now: Date): Promise<MetricRecord[]> {
  const a = schema.articles;
  const real = (idCol: AnyPgColumn, title: AnyPgColumn) => and(not(like(idCol, `${SEED_ID_PREFIX}%`)), not(like(title, `${SEED_DEMO_LABEL}%`)));
  const countArticles = async (days: number): Promise<number> => {
    const since = new Date(now.getTime() - days * DIA);
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(a)
      .where(and(inArray(a.status, ['publicado', 'corrigido']), sql`${a.classeDeDado} = 'public'`, gte(a.publicadoEm, since), sql`${a.publicadoEm} <= ${now}`, real(a.id, a.titulo)));
    return r?.n ?? 0;
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
  const ev = schema.agendaEvents;
  const [evs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ev)
    .where(and(sql`${ev.moderacao} = 'aprovado'`, gte(ev.inicio, today), real(ev.id, ev.titulo)));
  const at = now.toISOString();
  const rec = (metric: string, value: number, start: Date, end: Date): MetricRecord[] =>
    value > 0 ? [{ source: 'cms', metric, value, period_start: start.toISOString(), period_end: end.toISOString(), fetched_at: at, status: 'available', methodology_version: CMS_METHODOLOGY }] : [];
  return [
    ...rec('articles_published_30d', await countArticles(30), new Date(now.getTime() - 30 * DIA), now),
    ...rec('articles_published_90d', await countArticles(90), new Date(now.getTime() - 90 * DIA), now),
    ...rec('upcoming_events', evs?.n ?? 0, now, new Date(now.getTime() + 730 * DIA)),
  ];
}

/**
 * Linhas diárias de entrega (ad_delivery_daily) dos criativos DE UMA campanha, só na janela pedida (from/to inclusivos, AAAA-MM-DD). Alimenta o relatório do
 * anunciante; sem `campaignId` válido devolve vazio (o handler recusa a entrada). `updatedAt` é a "data do dado" (o flush do Redis é por minuto).
 */
/**
 * Data de calendário REAL (AAAA-MM-DD). Mês 13, dia 32 e mês 00 dão Date inválida: `toISOString` lançaria RangeError (500, antes do schema da rota),
 * por isso o NaN é checado primeiro. 30/02 o Date normaliza para março: o ida-e-volta pega.
 */
export const realDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

export async function loadDelivery(db: Db, input: unknown): Promise<DeliveryRow[]> {
  const i = (input && typeof input === 'object' ? input : {}) as { campaignId?: unknown; accountId?: unknown; from?: unknown; to?: unknown };
  // por campanha (relatório de campanha) OU por anunciante (todas as campanhas da conta); sem nenhum dos dois, nada é lido
  const byCampaign = typeof i.campaignId === 'string' && i.campaignId !== '';
  const byAccount = !byCampaign && typeof i.accountId === 'string' && i.accountId !== '';
  if (!byCampaign && !byAccount) return [];
  const d = schema.adDeliveryDaily;
  // só data de calendário REAL (2026-02-30 e 2026-13-01 não vão ao banco: o PostgreSQL as recusaria com erro); o handler responde 400 à entrada inválida
  const rows = await db
    .select({ r: d })
    .from(d)
    .innerJoin(schema.adCreatives, eq(schema.adCreatives.id, d.criativoId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.adCreatives.campanhaId))
    .where(and(byCampaign ? eq(schema.adCreatives.campanhaId, i.campaignId as string) : eq(schema.campaigns.contaId, i.accountId as string), realDay(i.from) ? gte(d.dia, i.from) : undefined, realDay(i.to) ? lte(d.dia, i.to) : undefined));
  return rows.map(({ r }) => ({
    creativeId: r.criativoId, day: r.dia, served: r.servidas, visible: r.visiveis, clicks: r.cliques,
    ignoredBotInternal: r.ignoradasBotInterno, refreshSuppressed: r.refreshSuprimido, updatedAt: r.atualizadoEm.toISOString(),
  }));
}

/** Lacunas de auditoria recentes sempre carregadas (painel e atenção). As mais antigas só entram quando tocam a campanha ou a conta pedida. */
export const GAP_RECENT_DAYS = 30;
/**
 * O que a requisição pediu (query do relatório, do detalhe e do painel): campanha, conta ou janela de datas. Define os períodos em que as
 * lacunas antigas também importam. `from`/`to` só valem se forem datas de calendário REAIS (AAAA-MM-DD) e `from` <= `to`; senão são ignorados.
 */
export interface GapScope { campaignId?: string; accountId?: string; from?: string; to?: string }

/** `env` = ambiente de flags (APP_ENV): decide quais formatos têm venda liberada (CAPACITY_RELEASES). Local, CI e ausente: nenhum. */
export async function hydrate(db: Db, now: Date = new Date(), env: FlagEnv | null = flagEnvFrom(process.env.APP_ENV), scope: GapScope = {}): Promise<Hydrated> {
  const [catalog, slots, accs, leads, opps, hist, camps, ress, tkos, creatives, deliv, mets, ctts, cpos] = await Promise.all([
    loadCatalog(db, env), db.select().from(schema.adSlots), db.select().from(schema.crmAccounts),
    db.select().from(schema.crmLeads), db.select().from(schema.crmOpportunities),
    db.select().from(schema.crmOpportunityHistory).orderBy(schema.crmOpportunityHistory.em, schema.crmOpportunityHistory.id),
    db.select().from(schema.campaigns), db.select().from(schema.adReservations), db.select().from(schema.adTakeovers),
    loadCreatives(db), db.select().from(schema.adDeliveryDaily), db.select().from(schema.commercialMetrics),
    db.select().from(schema.crmContacts).orderBy(schema.crmContacts.criadoEm, schema.crmContacts.id),
    db.select().from(schema.campaignPositions).orderBy(schema.campaignPositions.campanhaId, schema.campaignPositions.ordem),
  ]);

  const leadList: Lead[] = leads.map((l) => ({
    id: l.id, name: l.nome, company: l.empresa, email: l.email, whatsapp: l.whatsapp, formatIds: l.formatoIds as string[],
    objective: l.objetivo, message: l.mensagem ?? '', newsletterOptIn: l.optInNewsletter, status: l.status,
    createdAt: iso(l.criadoEm), accountId: l.contaId, consentAt: iso(l.consentimentoEm),
  }));
  const accountList: Account[] = accs.map((a) => ({
    id: a.id, name: a.nome, leadIds: leadList.filter((l) => l.accountId === a.id).map((l) => l.id), createdAt: iso(a.criadoEm),
  }));
  const oppList: Opportunity[] = opps.map((o) => ({
    id: o.id, accountId: o.contaId, leadId: o.leadId, title: o.titulo, formatIds: o.formatoIds as string[], stage: o.estagio,
    lostReason: o.motivoPerda, nextAction: o.proximaAcao, nextActionDue: o.proximaAcaoPrazo, amountBRL: num(o.valorBrl),
    proposalVersions: o.versoesProposta,
    history: hist.filter((h) => h.oportunidadeId === o.id).map((h) => ({ from: h.de, to: h.para, at: iso(h.em) })),
  }));
  const crm = new Crm();
  const contactList: Contact[] = ctts.map((k) => ({
    id: k.id, accountId: k.contaId, name: k.nome, email: k.email, whatsapp: k.whatsapp, role: k.cargo, basis: k.baseLegal as ContactBasis,
    consentAt: iso(k.consentimentoEm), registeredBy: k.registradoPor, classeDeDado: 'personal', createdAt: iso(k.criadoEm),
  }));
  crm.load({ version: SNAPSHOT_VERSION, seq: 0, leads: leadList, accounts: accountList, opportunities: oppList, contacts: contactList });

  const positions: BannerPosition[] = slots.length
    ? slots.map((s) => {
        const base = POSITIONS.find((p) => p.id === s.id);
        return {
          id: s.id, name: base?.name ?? s.id, formatId: s.formatoId, desktop: s.dimensaoDesktop === 'parametrizavel' ? null : s.dimensaoDesktop,
          mobile: s.variantesMobile as string[], slotLimit: s.limiteCotas, maxWeightKB: s.pesoMaxKb, minContractDays: s.contratoMinimoDias,
          allowedTypes: s.tiposPermitidos as string[],
        };
      })
    : [...POSITIONS];
  const inventory = new InventoryBook(positions);
  inventory.load({
    version: SNAPSHOT_VERSION, seq: 0,
    reservations: ress.map((r): Reservation => ({
      id: r.id, positionId: r.slotId, advertiserId: r.contaId, campaignId: r.campanhaId, startDate: r.inicio, endDate: r.fim, status: r.status,
    })),
    takeovers: tkos.map((t): Takeover => ({ id: t.id, date: t.dia, advertiserId: t.contaId, agreedCampaignIds: t.campanhasAcordadas as string[] })),
  });

  const posBy = new Map<string, string[]>();
  for (const p of cpos) (posBy.get(p.campanhaId) ?? posBy.set(p.campanhaId, []).get(p.campanhaId)!).push(p.slotId);
  const posOf = (id: string, slot: string | null): string[] => posBy.get(id) ?? (slot ? [slot] : []);
  const campaigns = new CampaignBook();
  campaigns.load({
    version: SNAPSHOT_VERSION, seq: 0,
    campaigns: camps.map((c): Campaign => ({
      id: c.id, name: c.nome, accountId: c.contaId, opportunityId: c.oportunidadeId, formatId: c.formatoId,
      // Posições de campaign_positions (na ordem gravada); linha legada sem posições lá: a de campaigns.slot_id.
      ...((ids) => ({ positionIds: ids, positionId: ids[0] ?? null }))(posOf(c.id, c.slotId)),
      startDate: c.inicio, endDate: c.fim, status: c.status, sponsoredLabel: true, // F-074: o banco só aceita campanha rotulada
      reservationIds: inventory.list().filter((r) => r.campaignId === c.id && r.status !== 'cancelled').map((r) => r.id),
      history: c.historico as Campaign['history'],
    })),
  });

  // anúncios: o Studio só lê contadores (entrega diária do banco); servir é no ads.ts, com Redis
  const server = new AdServer(new ImpressionLedger({ newId: () => crypto.randomUUID() }));
  server.loadCreatives(creatives);
  const counters: Record<string, DeliveryCounters> = {};
  for (const d of deliv) {
    const c = (counters[d.criativoId] ??= ZERO());
    c.served += d.servidas; c.visible += d.visiveis; c.clicks += d.cliques;
    c.ignoredBotOrInternal += d.ignoradasBotInterno; c.refreshSuppressed += d.refreshSuprimido;
  }
  server.loadCounters(counters);
  // lacunas de auditoria (perda de dedupe no Redis): os relatórios marcam o período como "não auditável" (piso, não total).
  // Não carrega todas: as dos últimos GAP_RECENT_DAYS (painel e atenção) + as que tocam o período da campanha ou da conta pedida
  // (relatório, detalhe). Assim nunca sai "auditável" por falta de leitura, e a leitura não cresce com o histórico.
  const own = scope.campaignId ? campaigns.list().filter((c) => c.id === scope.campaignId)
    : scope.accountId ? campaigns.list().filter((c) => c.accountId === scope.accountId) : [];
  // a janela pedida só vale até MAX_WINDOW_DAYS (a mesma dos relatórios e do painel): as maiores são recusadas pela rota (400) e não fazem a leitura varrer o histórico
  const janela: [number, number][] = realDay(scope.from) && realDay(scope.to) && scope.from <= scope.to
    && Math.round((Date.parse(`${scope.to}T00:00:00Z`) - Date.parse(`${scope.from}T00:00:00Z`)) / 86_400_000) + 1 <= MAX_WINDOW_DAYS ? [campaignPeriodMs(scope.from, scope.to)] : [];
  const spans: [number, number][] = [[now.getTime() - GAP_RECENT_DAYS * 86_400_000, Number.POSITIVE_INFINITY], ...own.map((c) => campaignPeriodMs(c.startDate, c.endDate)), ...janela];
  const earliest = Math.min(...spans.map(([a]) => a));
  const gaps = (await loadGaps(db, { activeAt: new Date(earliest) })).filter((g) => spans.some(([a, b]) => Date.parse(g.from) < b && a < Date.parse(g.to)));
  loadGapsInto(server.audit, gaps);

  const metrics = new MetricStore();
  // a cobertura `cms` é CONTADA agora, só com conteúdo real (nunca o seed); o que estiver gravado para essas três métricas não vale mais
  const cmsNow = await cmsCoverageMetrics(db, now);
  const CMS_KEYS = new Set(['articles_published_30d', 'articles_published_90d', 'upcoming_events']);
  metrics.load({
    version: SNAPSHOT_VERSION,
    records: [
      ...mets
        .filter((m) => m.status !== 'unavailable' && m.valor !== null && m.periodoInicio && m.periodoFim && m.coletadoEm)
        .filter((m) => !(m.origem === 'cms' && CMS_KEYS.has(m.metrica)))
        .map((m): MetricRecord => ({
          source: m.origem, metric: m.metrica, value: Number(m.valor), period_start: iso(m.periodoInicio!), period_end: iso(m.periodoFim!),
          fetched_at: iso(m.coletadoEm!), status: m.status, methodology_version: m.versaoMetodologia,
        })),
      ...cmsNow,
    ],
  });

  const state: CommercialState = { catalog, crm, inventory, campaigns, ads: server, metrics };
  return { state, before: rowsOf(state) };
}

/** Linhas do banco equivalentes ao estado do domínio (usadas para a diferença antes/depois). */
export function rowsOf(s: CommercialState): Rows {
  const crm = s.crm.snapshot();
  const inv = s.inventory.snapshot();
  const camps = s.campaigns.snapshot().campaigns;
  return {
    accounts: crm.accounts.map((a) => ({ id: a.id, nome: a.name, criadoEm: new Date(a.createdAt) })),
    contacts: (crm.contacts ?? []).map((k) => ({
      id: k.id, contaId: k.accountId, nome: k.name, email: k.email, whatsapp: k.whatsapp, cargo: k.role, baseLegal: k.basis,
      consentimentoEm: new Date(k.consentAt), registradoPor: k.registeredBy, classeDeDado: 'personal', criadoEm: new Date(k.createdAt),
    })),
    leads: crm.leads.map((l) => ({
      id: l.id, nome: l.name, empresa: l.company, email: l.email, whatsapp: l.whatsapp, formatoIds: l.formatIds, objetivo: l.objective,
      mensagem: l.message || null, optInNewsletter: l.newsletterOptIn, consentimentoEm: new Date(l.consentAt), classeDeDado: 'personal',
      status: l.status, contaId: l.accountId, criadoEm: new Date(l.createdAt),
    })),
    opportunities: crm.opportunities.map((o) => ({
      id: o.id, contaId: o.accountId, leadId: o.leadId, titulo: o.title, formatoIds: o.formatIds, estagio: o.stage, motivoPerda: o.lostReason,
      proximaAcao: o.nextAction, proximaAcaoPrazo: o.nextActionDue, valorBrl: o.amountBRL === null ? null : String(o.amountBRL),
      versoesProposta: o.proposalVersions,
    })),
    history: crm.opportunities.flatMap((o) => o.history.map((h, i) => ({ id: `${o.id}#${i}`, oportunidadeId: o.id, de: h.from, para: h.to, em: new Date(h.at) }))),
    // slot_id = a PRIMEIRA posição (leitores antigos); todas as posições, em ordem, em campaign_positions
    campaigns: camps.map((c) => ({
      id: c.id, nome: c.name, contaId: c.accountId, oportunidadeId: c.opportunityId, formatoId: c.formatId, slotId: c.positionIds[0] ?? c.positionId ?? null,
      inicio: c.startDate, fim: c.endDate, status: c.status, rotulada: true, historico: c.history,
    })),
    campaignPositions: camps.flatMap((c) => c.positionIds.map((slotId, ordem) => ({ id: `${c.id}#${slotId}`, campanhaId: c.id, slotId, ordem }))),
    reservations: inv.reservations.map((r) => ({
      id: r.id, slotId: r.positionId, contaId: r.advertiserId, campanhaId: r.campaignId, inicio: r.startDate, fim: r.endDate, status: r.status,
    })),
    takeovers: inv.takeovers.map((t) => ({ id: t.id, dia: t.date, contaId: t.advertiserId, campanhasAcordadas: t.agreedCampaignIds })),
    creatives: s.ads.listCreatives().map((c) => ({
      id: c.id, campanhaId: c.campaignId, slotId: c.positionId, peso: Math.max(1, Math.round(c.weight)), inicio: c.startDate, fim: c.endDate,
      aprovado: c.approved,
      arquivoRef: c.asset?.key ?? null, arquivoMime: c.asset?.mime ?? null, largura: c.asset?.width ?? null, altura: c.asset?.height ?? null,
      tamanhoKb: c.asset?.sizeKB ?? null, arquivoSha256: c.asset?.sha256 ?? null, textoAlternativo: c.altText ?? null, destinoUrl: c.destinationUrl ?? null,
    })),
    metrics: s.metrics.all().map((m) => ({
      id: `${m.source}::${m.metric}`, origem: m.source, metrica: m.metric, valor: m.value === null ? null : String(m.value),
      periodoInicio: m.period_start ? new Date(m.period_start) : null, periodoFim: m.period_end ? new Date(m.period_end) : null,
      coletadoEm: m.fetched_at ? new Date(m.fetched_at) : null, status: m.status, versaoMetodologia: m.methodology_version,
    })),
  };
}

const changed = (after: Row[], before: Row[]): Row[] => {
  const prev = new Map(before.map((r) => [r.id, JSON.stringify(r)]));
  return after.filter((r) => prev.get(r.id) !== JSON.stringify(r));
};

async function upsert(db: Db, table: PgTable, rows: Row[], target: AnyPgColumn[]): Promise<void> {
  if (!rows.length) return;
  const cols = getTableColumns(table) as Record<string, AnyPgColumn>;
  const keys = Object.keys(rows[0]!);
  const set: Record<string, SQL> = {};
  for (const k of keys) {
    const col = cols[k];
    if (!col) throw new Error(`coluna desconhecida ${k}`);
    if (!target.includes(col)) set[k] = sql.raw(`excluded."${col.name}"`);
  }
  await db.insert(table).values(rows as never).onConflictDoUpdate({ target, set });
}

/** Grava só o que mudou, em ordem de dependência (FKs). A entrega de anúncios NÃO é gravada aqui (ads.ts + worker). */
export async function persist(db: Db, h: Hydrated, after: CommercialState): Promise<void> {
  const a = rowsOf(after);
  const b = h.before;
  await upsert(db, schema.crmAccounts, changed(a.accounts, b.accounts), [schema.crmAccounts.id]);
  try {
    await upsert(db, schema.crmContacts, changed(a.contacts, b.contacts), [schema.crmContacts.id]);
  } catch (e) {
    // o domínio já recusa e-mail repetido na conta; o índice único é a segunda barreira (outra instância, banco alterado por fora)
    if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') {
      throw new HttpError(409, 'DUPLICATE_CONTACT', 'Já existe um contato com este e-mail nesta conta.');
    }
    throw e;
  }
  await upsert(db, schema.crmLeads, changed(a.leads, b.leads), [schema.crmLeads.id]);
  await upsert(db, schema.crmOpportunities, changed(a.opportunities, b.opportunities), [schema.crmOpportunities.id]);
  await upsert(db, schema.crmOpportunityHistory, changed(a.history, b.history), [schema.crmOpportunityHistory.id]);
  await upsert(db, schema.campaigns, changed(a.campaigns, b.campaigns), [schema.campaigns.id]);
  await syncPositions(db, a.campaignPositions, b.campaignPositions);
  await upsert(db, schema.adReservations, changed(a.reservations, b.reservations), [schema.adReservations.id]);
  await upsert(db, schema.adTakeovers, changed(a.takeovers, b.takeovers), [schema.adTakeovers.id]);
  await upsert(db, schema.adCreatives, changed(a.creatives, b.creatives), [schema.adCreatives.id]);
  await upsert(db, schema.commercialMetrics, changed(a.metrics, b.metrics), [schema.commercialMetrics.origem, schema.commercialMetrics.metrica]);
}

/** Regrava as posições SÓ das campanhas cuja lista (ou ordem) mudou: apaga as dessa campanha e insere a lista nova. Roda na transação do persist. */
async function syncPositions(db: Db, after: Row[], before: Row[]): Promise<void> {
  const key = (rows: Row[]) => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(String(r.campanhaId), `${m.get(String(r.campanhaId)) ?? ''}|${String(r.slotId)}`);
    return m;
  };
  const ka = key(after);
  const kb = key(before);
  const ids = [...new Set([...ka.keys(), ...kb.keys()])].filter((id) => ka.get(id) !== kb.get(id));
  if (!ids.length) return;
  await db.delete(schema.campaignPositions).where(inArray(schema.campaignPositions.campanhaId, ids));
  const rows = after.filter((r) => ids.includes(String(r.campanhaId))).map(({ campanhaId, slotId, ordem }) => ({ campanhaId, slotId, ordem }));
  if (rows.length) await db.insert(schema.campaignPositions).values(rows as never);
}
