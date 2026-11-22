// Repositório do módulo comercial: hidrata o contexto do domínio (@ln/commercial) a partir do PostgreSQL
// (schema em @ln/db/schema/commercial.ts) e persiste só o que o handler mudou (diferença linha a linha).
// Leituras: sem lock. Escritas: uma transação com lock consultivo (pg_advisory_xact_lock), então reservas e
// transições se serializam. Hoje carrega as tabelas inteiras por requisição (volume pequeno; otimizar depois).
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  AdServer, CampaignBook, CATALOG, Crm, InventoryBook, MetricStore, POSITIONS,
  type BannerPosition, type Campaign, type CommercialFormat, type CommercialState, type Creative, type DeliveryCounters,
  type Lead, type Opportunity, type Reservation, type Takeover,
} from '@ln/commercial';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { ads, camp, crmSeq, inv, maxSeq } from './internals';

export const COMMERCIAL_LOCK = 7_010_001;

type Row = Record<string, unknown> & { id: string };
export interface Rows {
  accounts: Row[]; leads: Row[]; opportunities: Row[]; history: Row[]; campaigns: Row[];
  reservations: Row[]; takeovers: Row[]; creatives: Row[]; metrics: Row[];
}
export interface Hydrated {
  state: CommercialState;
  before: Rows;
  /** Contadores de entrega ao hidratar (para gravar só o delta do dia). */
  deliveryBase: Map<string, DeliveryCounters>;
}

// ---------- memória de impressões (processo) ----------
// O banco guarda só agregado diário (sem dado de leitor). A deduplicação de impressão/refresh/clique vive aqui,
// por processo: com mais de uma instância servindo anúncios ela deixa de ser estrita. Limitação registrada.
const mem = {
  credit: new Map<string, number>(), views: new Map<string, string>(), impressionCreative: new Map<string, string>(),
  visibleSet: new Set<string>(), clickedSet: new Set<string>(), seq: 0,
};
const MEM_CAP = 100_000;

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

export async function hydrate(db: Db): Promise<Hydrated> {
  const [fmts, slots, accs, leads, opps, hist, camps, ress, tkos, crs, deliv, mets] = await Promise.all([
    db.select().from(schema.adFormats), db.select().from(schema.adSlots), db.select().from(schema.crmAccounts),
    db.select().from(schema.crmLeads), db.select().from(schema.crmOpportunities),
    db.select().from(schema.crmOpportunityHistory).orderBy(schema.crmOpportunityHistory.em, schema.crmOpportunityHistory.id),
    db.select().from(schema.campaigns), db.select().from(schema.adReservations), db.select().from(schema.adTakeovers),
    db.select().from(schema.adCreatives), db.select().from(schema.adDeliveryDaily), db.select().from(schema.commercialMetrics),
  ]);

  // catálogo: o código define o formato; o banco (ajustável no admin) manda no estado de disponibilidade
  const byFmt = new Map(fmts.map((f) => [f.id, f]));
  const catalog: CommercialFormat[] = CATALOG.map((f) => {
    const r = byFmt.get(f.id);
    return r ? { ...f, status: r.disponibilidade, statusReason: r.motivoDisponibilidade } : f;
  });

  const crm = new Crm();
  for (const a of accs) crm.accounts.set(a.id, { id: a.id, name: a.nome, leadIds: [], createdAt: iso(a.criadoEm) });
  for (const l of leads) {
    const lead: Lead = {
      id: l.id, name: l.nome, company: l.empresa, email: l.email, whatsapp: l.whatsapp, formatIds: l.formatoIds as string[],
      objective: l.objetivo, message: l.mensagem ?? '', newsletterOptIn: l.optInNewsletter, status: l.status,
      createdAt: iso(l.criadoEm), accountId: l.contaId, consentAt: iso(l.consentimentoEm),
    };
    crm.leads.set(lead.id, lead);
    if (lead.accountId) crm.accounts.get(lead.accountId)?.leadIds.push(lead.id);
  }
  for (const o of opps) {
    const opp: Opportunity = {
      id: o.id, accountId: o.contaId, leadId: o.leadId, title: o.titulo, formatIds: o.formatoIds as string[], stage: o.estagio,
      lostReason: o.motivoPerda, nextAction: o.proximaAcao, nextActionDue: o.proximaAcaoPrazo, amountBRL: num(o.valorBrl),
      proposalVersions: o.versoesProposta,
      history: hist.filter((h) => h.oportunidadeId === o.id).map((h) => ({ from: h.de, to: h.para, at: iso(h.em) })),
    };
    crm.opportunities.set(opp.id, opp);
  }
  crmSeq(crm).seq = maxSeq([...crm.leads.keys(), ...crm.accounts.keys(), ...crm.opportunities.keys()]);

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
  const iv = inv(inventory);
  iv.reservations = ress.map((r): Reservation => ({
    id: r.id, positionId: r.slotId, advertiserId: r.contaId, campaignId: r.campanhaId, startDate: r.inicio, endDate: r.fim, status: r.status,
  }));
  iv.takeovers = tkos.map((t): Takeover => ({ id: t.id, date: t.dia, advertiserId: t.contaId, agreedCampaignIds: t.campanhasAcordadas as string[] }));
  iv.seq = maxSeq([...iv.reservations.map((r) => r.id), ...iv.takeovers.map((t) => t.id)]);

  const campaigns = new CampaignBook();
  const cb = camp(campaigns);
  for (const c of camps) {
    cb.items.set(c.id, {
      id: c.id, name: c.nome, accountId: c.contaId, opportunityId: c.oportunidadeId, formatId: c.formatoId, positionId: c.slotId,
      startDate: c.inicio, endDate: c.fim, status: c.status, sponsoredLabel: true, // F-074: o banco só aceita campanha rotulada
      reservationIds: iv.reservations.filter((r) => r.campaignId === c.id && r.status !== 'cancelled').map((r) => r.id),
      history: c.historico as Campaign['history'],
    });
  }
  cb.seq = maxSeq(cb.items.keys());

  const server = new AdServer();
  const av = ads(server);
  const activeCampaigns = new Set(camps.filter((c) => c.status === 'active').map((c) => c.id));
  av.creatives = crs.map((c): Creative => ({
    id: c.id, campaignId: c.campanhaId, positionId: c.slotId, weight: c.peso, startDate: c.inicio, endDate: c.fim,
    approved: c.aprovado, campaignActive: activeCampaigns.has(c.campanhaId), label: 'publicidade',
  }));
  const deliveryBase = new Map<string, DeliveryCounters>();
  for (const d of deliv) {
    const c = deliveryBase.get(d.criativoId) ?? { served: 0, visible: 0, clicks: 0, ignoredBotOrInternal: 0, refreshSuppressed: 0 };
    c.served += d.servidas; c.visible += d.visiveis; c.clicks += d.cliques;
    c.ignoredBotOrInternal += d.ignoradasBotInterno; c.refreshSuppressed += d.refreshSuprimido;
    deliveryBase.set(d.criativoId, c);
  }
  for (const [id, c] of deliveryBase) av.counters.set(id, { ...c });
  if (mem.views.size > MEM_CAP) { mem.views.clear(); mem.impressionCreative.clear(); mem.visibleSet.clear(); mem.clickedSet.clear(); }
  Object.assign(av, mem); // compartilha os mapas de impressão do processo

  const metrics = new MetricStore();
  for (const m of mets) {
    if (m.status === 'unavailable' || m.valor === null || !m.periodoInicio || !m.periodoFim || !m.coletadoEm) continue;
    metrics.ingest({
      source: m.origem, metric: m.metrica, value: Number(m.valor), period_start: iso(m.periodoInicio), period_end: iso(m.periodoFim),
      fetched_at: iso(m.coletadoEm), methodology_version: m.versaoMetodologia,
    });
    if (m.status === 'stale') metrics.markFailure({ source: m.origem, metric: m.metrica });
  }

  const state: CommercialState = { catalog, crm, inventory, campaigns, ads: server, metrics };
  return { state, before: rowsOf(state), deliveryBase };
}

/** Linhas do banco equivalentes ao estado do domínio (usadas para a diferença antes/depois). */
export function rowsOf(s: CommercialState): Rows {
  const crm = s.crm;
  const opps = [...crm.opportunities.values()];
  const camps = camp(s.campaigns).items;
  return {
    accounts: [...crm.accounts.values()].map((a) => ({ id: a.id, nome: a.name, criadoEm: new Date(a.createdAt) })),
    leads: [...crm.leads.values()].map((l) => ({
      id: l.id, nome: l.name, empresa: l.company, email: l.email, whatsapp: l.whatsapp, formatoIds: l.formatIds, objetivo: l.objective,
      mensagem: l.message || null, optInNewsletter: l.newsletterOptIn, consentimentoEm: new Date(l.consentAt), classeDeDado: 'personal',
      status: l.status, contaId: l.accountId, criadoEm: new Date(l.createdAt),
    })),
    opportunities: opps.map((o) => ({
      id: o.id, contaId: o.accountId, leadId: o.leadId, titulo: o.title, formatoIds: o.formatIds, estagio: o.stage, motivoPerda: o.lostReason,
      proximaAcao: o.nextAction, proximaAcaoPrazo: o.nextActionDue, valorBrl: o.amountBRL === null ? null : String(o.amountBRL),
      versoesProposta: o.proposalVersions,
    })),
    history: opps.flatMap((o) => o.history.map((h, i) => ({ id: `${o.id}#${i}`, oportunidadeId: o.id, de: h.from, para: h.to, em: new Date(h.at) }))),
    campaigns: [...camps.values()].map((c) => ({
      id: c.id, nome: c.name, contaId: c.accountId, oportunidadeId: c.opportunityId, formatoId: c.formatId, slotId: c.positionId,
      inicio: c.startDate, fim: c.endDate, status: c.status, rotulada: true, historico: c.history,
    })),
    reservations: inv(s.inventory).reservations.map((r) => ({
      id: r.id, slotId: r.positionId, contaId: r.advertiserId, campanhaId: r.campaignId, inicio: r.startDate, fim: r.endDate, status: r.status,
    })),
    takeovers: inv(s.inventory).takeovers.map((t) => ({ id: t.id, dia: t.date, contaId: t.advertiserId, campanhasAcordadas: t.agreedCampaignIds })),
    creatives: s.ads.listCreatives().map((c) => ({
      id: c.id, campanhaId: c.campaignId, slotId: c.positionId, peso: Math.max(1, Math.round(c.weight)), inicio: c.startDate, fim: c.endDate,
      aprovado: c.approved,
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

export async function persist(db: Db, h: Hydrated, after: CommercialState, today: string): Promise<void> {
  const a = rowsOf(after);
  const b = h.before;
  await upsert(db, schema.crmAccounts, changed(a.accounts, b.accounts), [schema.crmAccounts.id]);
  await upsert(db, schema.crmLeads, changed(a.leads, b.leads), [schema.crmLeads.id]);
  await upsert(db, schema.crmOpportunities, changed(a.opportunities, b.opportunities), [schema.crmOpportunities.id]);
  await upsert(db, schema.crmOpportunityHistory, changed(a.history, b.history), [schema.crmOpportunityHistory.id]);
  await upsert(db, schema.campaigns, changed(a.campaigns, b.campaigns), [schema.campaigns.id]);
  await upsert(db, schema.adReservations, changed(a.reservations, b.reservations), [schema.adReservations.id]);
  await upsert(db, schema.adTakeovers, changed(a.takeovers, b.takeovers), [schema.adTakeovers.id]);
  await upsert(db, schema.adCreatives, changed(a.creatives, b.creatives), [schema.adCreatives.id]);
  await upsert(db, schema.commercialMetrics, changed(a.metrics, b.metrics), [schema.commercialMetrics.origem, schema.commercialMetrics.metrica]);

  // entrega: só o delta do dia, somado à linha (criativo, dia)
  const counters = ads(after.ads).counters;
  for (const [creativeId, c] of counters) {
    const base = h.deliveryBase.get(creativeId) ?? { served: 0, visible: 0, clicks: 0, ignoredBotOrInternal: 0, refreshSuppressed: 0 };
    const d = {
      servidas: c.served - base.served, visiveis: c.visible - base.visible, cliques: c.clicks - base.clicks,
      ignoradasBotInterno: c.ignoredBotOrInternal - base.ignoredBotOrInternal, refreshSuprimido: c.refreshSuppressed - base.refreshSuppressed,
    };
    if (!Object.values(d).some((v) => v !== 0)) continue;
    const t = schema.adDeliveryDaily;
    await db
      .insert(t)
      .values({ id: `${creativeId}@${today}`, criativoId: creativeId, dia: today, ...d })
      .onConflictDoUpdate({
        target: [t.criativoId, t.dia],
        set: {
          servidas: sql`${t.servidas} + ${d.servidas}`, visiveis: sql`${t.visiveis} + ${d.visiveis}`, cliques: sql`${t.cliques} + ${d.cliques}`,
          ignoradasBotInterno: sql`${t.ignoradasBotInterno} + ${d.ignoradasBotInterno}`,
          refreshSuprimido: sql`${t.refreshSuprimido} + ${d.refreshSuprimido}`, atualizadoEm: new Date(),
        },
      });
  }
  Object.assign(mem, { seq: ads(after.ads).seq }); // mantém o contador de impressões do processo
}

