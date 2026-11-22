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
  getOrganization, getOrgRelations, getPerson, getPersonRoles, listMoveViews, listWatchlistItems, listWatchlists, searchOrganizations,
  type MoveView,
} from './queries';
import { listAlerts } from './watchlists';
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
