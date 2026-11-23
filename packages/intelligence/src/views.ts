/**
 * Funções de dados para telas — separadas por audiência.
 *  - Portal (público): só fato declarado, só Move confirmado; nenhuma inferência, nenhum alerta, nenhuma watchlist.
 *  - Studio: tudo, inclusive pendentes e inferidos, sempre rotulados.
 * Cada item carrega `evidence` (fonte, data de coleta, is_mock) e `validated_at`: a UI exibe fonte e data de validação
 * e escreve o texto MOCK quando `is_mock` é verdadeiro. `empty` é verdadeiro quando não há registro (estado vazio honesto).
 */
import type { Db } from './db';
import { currentPeopleAt } from './graph';
import { getOrgChart } from './repo';
import {
  countMoveViews, getOrganization, getOrgRelations, getPerson, getPersonRoles, listMoveViews, listWatchlistItems, listWatchlists, searchOrganizations,
  type MoveView,
} from './queries';
import { listAlerts } from './watchlists';
import { layoutOrgChart, renderOrgChartSvg } from './org-layout';
import type { Uuid } from './types';

const today = () => new Date().toISOString().slice(0, 10);

export const PUBLIC_NOTICE = 'Informação profissional de fonte pública, com data de validação. Ausência de registro não prova inexistência.';

// ---------------- Portal ----------------

export async function portalCompanyPage(db: Db, organizationId: Uuid, asOf = today()) {
  const organization = await getOrganization(db, organizationId);
  if (!organization) return null;
  const [people, relations, chart, moves] = await Promise.all([
    currentPeopleAt(db, organizationId, asOf),
    getOrgRelations(db, organizationId, asOf, false),
    getOrgChart(db, organizationId, asOf, { includeInferred: false }),
    listMoveViews(db, { organizationId, status: ['confirmed'], limit: 20 }),
  ]);
  const declared = people.filter((p) => p.certainty === 'declared');
  return {
    organization, as_of: asOf, people: declared, relations, org_chart: chart, recent_moves: moves, notice: PUBLIC_NOTICE,
    empty: declared.length === 0 && relations.length === 0 && chart.length === 0,
    has_mock: organization.evidence.is_mock || moves.some((m) => m.evidence.is_mock) || relations.some((r) => r.evidence.is_mock),
  };
}

export async function portalExecutivePage(db: Db, personId: Uuid) {
  const person = await getPerson(db, personId);
  if (!person) return null;
  const roles = await getPersonRoles(db, personId, false);
  const moves = await listMoveViews(db, { personId, status: ['confirmed'], limit: 20 });
  return {
    person: { id: person.id, full_name: person.full_name, evidence: person.evidence },
    current_roles: roles.filter((r) => r.valid_to === null),
    history: roles.filter((r) => r.valid_to !== null),
    moves, notice: PUBLIC_NOTICE, empty: roles.length === 0,
    has_mock: person.evidence.is_mock || roles.some((r) => r.evidence.is_mock),
  };
}

/** Feed "Loyalty Moves" do portal: apenas Moves confirmados por revisão. */
export async function portalMovesFeed(db: Db, opts: { limit?: number; offset?: number } = {}) {
  const items = await listMoveViews(db, { status: ['confirmed'], limit: opts.limit ?? 20, offset: opts.offset ?? 0 });
  return { items, notice: PUBLIC_NOTICE, empty: items.length === 0, has_mock: items.some((m) => m.evidence.is_mock) };
}

export async function portalSearch(db: Db, q: string) {
  return { companies: await searchOrganizations(db, q, 10) };
}

// ---------------- Studio ----------------

export async function studioEntityOverview(db: Db, kind: 'organization' | 'person', id: Uuid, asOf = today()) {
  if (kind === 'organization') {
    const organization = await getOrganization(db, id);
    if (!organization) return null;
    return {
      kind, organization, as_of: asOf,
      people: await currentPeopleAt(db, id, asOf), // inclui certeza por linha
      relations: await getOrgRelations(db, id, asOf, true),
      moves: await listMoveViews(db, { organizationId: id, limit: 50 }),
    };
  }
  const person = await getPerson(db, id);
  if (!person) return null;
  return { kind, person, roles: await getPersonRoles(db, id, true), moves: await listMoveViews(db, { personId: id, limit: 50 }) };
}

/** Organograma do Studio: inclui inferidas, cada uma com `display_label` ("inferido — não confirmado"). */
export async function studioOrgChart(db: Db, organizationId: Uuid, asOf = today()) {
  const edges = await getOrgChart(db, organizationId, asOf, { includeInferred: true });
  return { as_of: asOf, edges, declared: edges.filter((e) => e.certainty === 'declared').length, inferred: edges.filter((e) => e.certainty === 'inferred').length };
}

export async function studioMoveQueue(db: Db, opts: { limit?: number } = {}): Promise<{ pending: MoveView[]; count: number }> {
  const pending = await listMoveViews(db, { status: ['detected'], limit: opts.limit ?? 50 });
  return { pending, count: pending.length };
}

export async function studioWatchlistBoard(db: Db, ownerRef?: string) {
  const lists = await listWatchlists(db, ownerRef);
  return Promise.all(lists.map(async (w) => ({ ...w, entities: await listWatchlistItems(db, w.id) })));
}

export async function studioAlertQueue(db: Db) {
  const pending = await listAlerts(db, { status: 'pending_review' });
  return { pending, count: pending.length };
}

// ---------------- Loyalty Moves: portal (/moves), newsletter e alertas ----------------

const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Linha de Move pronta para exibir: texto determinístico (sem modelo), com fonte e ressalva de certeza. */
export interface MoveLine {
  id: Uuid;
  kind: MoveView['kind'];
  basis: MoveView['basis'];
  person_id: Uuid;
  person_name: string;
  from_organization: string | null;
  from_title: string | null;
  to_organization: string | null;
  to_title: string | null;
  effective_date: string | null;
  observed_on: string;
  /** Frase curta, ex.: "Ana assume como Diretora na Alfa". */
  text: string;
  /** Ressalva obrigatória: de onde vem a data e se foi a fonte que anunciou. */
  qualifier: string;
  source: { name: string; url: string; retrieved_at: string; is_mock: boolean };
  /** Linha de crédito: "Fonte: nome (consulta em dd/mm/aaaa)". */
  source_line: string;
}

/** Texto determinístico do Move. Nunca afirma data que a fonte não declarou. */
export function describeMove(m: Pick<MoveView, 'kind' | 'person_name' | 'from_organization' | 'from_title' | 'to_organization' | 'to_title'>): string {
  const who = m.person_name;
  switch (m.kind) {
    case 'appointment':
      return `${who} assume como ${m.to_title ?? 'novo cargo'}${m.to_organization ? ` na ${m.to_organization}` : ''}`;
    case 'departure':
      return `${who} deixa o cargo de ${m.from_title ?? 'cargo anterior'}${m.from_organization ? ` na ${m.from_organization}` : ''}`;
    case 'title_change':
      return `${who} muda de ${m.from_title ?? 'cargo anterior'} para ${m.to_title ?? 'novo cargo'}${m.to_organization ? ` na ${m.to_organization}` : ''}`;
    case 'org_change':
      return `${who} deixa ${m.from_organization ?? 'a empresa anterior'}${m.from_title ? ` (${m.from_title})` : ''} e assume ${m.to_title ?? 'novo cargo'}${m.to_organization ? ` na ${m.to_organization}` : ''}`;
  }
}

export function toMoveLine(m: MoveView): MoveLine {
  const qualifier =
    m.basis === 'announcement'
      ? `Anunciado pela fonte${m.effective_date ? `, com vigência em ${dmy(m.effective_date)}` : ''}.`
      : `Mudança identificada ao comparar consultas a fonte pública em ${dmy(m.observed_on)}; a data efetiva não foi informada pela fonte.`;
  return {
    id: m.id, kind: m.kind, basis: m.basis, person_id: m.person_id, person_name: m.person_name,
    from_organization: m.from_organization, from_title: m.from_title, to_organization: m.to_organization, to_title: m.to_title,
    effective_date: m.effective_date, observed_on: m.observed_on, text: describeMove(m), qualifier,
    source: { name: m.evidence.source_name, url: m.evidence.source_url, retrieved_at: m.evidence.retrieved_at, is_mock: m.evidence.is_mock },
    source_line: `Fonte: ${m.evidence.source_name} (consulta em ${dmy(m.evidence.retrieved_at)})`,
  };
}

export interface PortalMovesQuery {
  page?: number;
  pageSize?: number;
  kind?: MoveView['kind'];
  organizationId?: Uuid;
  /** AAAA-MM-DD */
  since?: string;
  until?: string;
}

/**
 * Dados da página /moves do portal: SOMENTE Moves confirmados por revisão (nunca detectados nem rejeitados),
 * todos com evidência (fonte + data de coleta), paginados e agrupados por mês. Estado vazio honesto.
 */
export async function portalMovesPage(db: Db, q: PortalMovesQuery = {}) {
  const pageSize = Math.min(Math.max(q.pageSize ?? 20, 1), 50);
  const page = Math.max(q.page ?? 1, 1);
  const filter = { status: ['confirmed' as const], kind: q.kind, organizationId: q.organizationId, since: q.since, until: q.until };
  const [total, rows] = await Promise.all([
    countMoveViews(db, filter),
    listMoveViews(db, { ...filter, limit: pageSize, offset: (page - 1) * pageSize }),
  ]);
  const items = rows.map(toMoveLine);
  const months: { month: string; items: MoveLine[] }[] = [];
  for (const it of items) {
    const month = it.observed_on.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.month === month) last.items.push(it);
    else months.push({ month, items: [it] });
  }
  return {
    items, months, total, page, page_size: pageSize, pages: Math.max(1, Math.ceil(total / pageSize)),
    filters: { kind: q.kind ?? null, organization_id: q.organizationId ?? null, since: q.since ?? null, until: q.until ?? null },
    notice: PUBLIC_NOTICE, empty: total === 0, has_mock: items.some((i) => i.source.is_mock),
  };
}

/**
 * Resumo de Moves para a newsletter (The Loyal; envio desligado por flag, aqui só dados): Moves confirmados no período,
 * texto plano pronto e itens estruturados. Nada de Move não revisado.
 */
export async function newsletterMovesDigest(db: Db, q: { since: string; until: string; limit?: number }) {
  const rows = await listMoveViews(db, { status: ['confirmed'], since: q.since, until: q.until, limit: q.limit ?? 20 });
  const items = rows.map(toMoveLine);
  const text_plain = items.map((i) => `• ${i.text}. ${i.qualifier} ${i.source_line}`).join('\n');
  return {
    period: { since: q.since, until: q.until }, items, text_plain, notice: PUBLIC_NOTICE, empty: items.length === 0,
    has_mock: items.some((i) => i.source.is_mock),
  };
}

/**
 * Alertas aprovados (revisados por alguém) com o Move correspondente, para envio/atendimento — só Studio.
 * Alerta pendente ou rejeitado nunca entra; Move rejeitado também não.
 */
export async function studioApprovedAlertsFeed(db: Db, q: { watchlistId?: Uuid; limit?: number } = {}) {
  const a = await db.query<{ id: Uuid; watchlist_id: Uuid; move_id: Uuid; reviewed_by: string; reviewed_at: string }>(
    `SELECT a.id, a.watchlist_id, a.move_id, a.reviewed_by, a.reviewed_at
       FROM intelligence.alert a
      WHERE a.status = 'approved' AND ($1::uuid IS NULL OR a.watchlist_id = $1)
      ORDER BY a.reviewed_at DESC, a.id LIMIT $2`,
    [q.watchlistId ?? null, Math.min(Math.max(q.limit ?? 50, 1), 200)],
  );
  const moves = a.rows.length
    ? await listMoveViews(db, { ids: a.rows.map((x) => x.move_id), status: ['detected', 'confirmed'], limit: 200 })
    : [];
  const byId = new Map(moves.map((m) => [m.id, m]));
  const items = a.rows
    .map((x) => ({ alert: x, move: byId.get(x.move_id) }))
    .filter((x): x is { alert: typeof x.alert; move: MoveView } => x.move !== undefined)
    .map((x) => ({
      alert_id: x.alert.id, watchlist_id: x.alert.watchlist_id, reviewed_by: x.alert.reviewed_by,
      reviewed_at: new Date(x.alert.reviewed_at).toISOString(), move: toMoveLine(x.move), move_status: x.move.status,
    }));
  return { items, empty: items.length === 0, has_mock: items.some((i) => i.move.source.is_mock) };
}

// ---------------- Organograma: layout determinístico ----------------

/**
 * Layout + SVG do organograma de uma organização. Portal: só vínculos declarados (inferido nunca chega);
 * Studio: com inferidos desenhados tracejados e rotulados "INFERIDO — NÃO CONFIRMADO". `has_mock` aciona a marca MOCK no SVG.
 */
export async function orgChartLayoutFor(db: Db, organizationId: Uuid, audience: 'public' | 'studio', asOf = today()) {
  const org = await getOrganization(db, organizationId);
  if (!org) return null;
  const edges = await getOrgChart(db, organizationId, asOf, { includeInferred: audience === 'studio' });
  const layout = layoutOrgChart(edges);
  const ev = edges.length
    ? await db.query<{ mock: boolean }>(`SELECT bool_or(is_mock) AS mock FROM intelligence.evidence WHERE id = ANY($1::uuid[])`, [[...new Set(edges.map((e) => e.evidence_id))]])
    : { rows: [{ mock: false }] };
  const has_mock = org.evidence.is_mock || ev.rows[0]?.mock === true;
  const svg = renderOrgChartSvg(layout, { mock: has_mock, title: `Organograma — ${org.legal_name} (${asOf})` });
  return {
    organization: { id: org.id, legal_name: org.legal_name }, as_of: asOf, layout, svg, has_mock,
    inferred_edges: layout.edges.filter((e) => e.certainty === 'inferred').length, notice: PUBLIC_NOTICE,
  };
}
