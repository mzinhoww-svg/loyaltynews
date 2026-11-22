/**
 * Handlers de API como funções puras: (db, input) -> { status, body }.
 * O Backend (apps/web/app/api) monta cada um numa rota, faz autenticação/RBAC e entrega `actor` (identidade já autenticada).
 * Nada aqui lê cabeçalhos, cookies ou variáveis de ambiente. Entrada desconhecida (unknown) é validada aqui.
 *
 * Rotas sugeridas (o Backend decide o desenho final):
 *   GET  /api/intelligence/companies?q=            -> searchCompaniesHandler        [portal, studio]
 *   GET  /api/intelligence/companies/:id           -> getCompanyHandler             [portal, studio]
 *   GET  /api/intelligence/executives?q=           -> searchExecutivesHandler       [portal, studio]
 *   GET  /api/intelligence/executives/:id          -> getExecutiveHandler           [portal, studio]
 *   GET  /api/intelligence/companies/:id/org-chart -> getOrgChartHandler            [portal, studio]
 *   GET  /api/intelligence/moves                   -> listMovesHandler              [portal: só confirmados; studio: todos]
 *   POST /api/studio/intelligence/moves/:id/review -> reviewMoveHandler             [studio, papel editor]
 *   GET/POST /api/studio/intelligence/watchlists, POST .../watchlists/:id/items     [studio]
 *   GET  /api/studio/intelligence/alerts           -> listAlertsHandler             [studio]
 *   POST /api/studio/intelligence/alerts/:id/review-> reviewAlertHandler            [studio, papel revisor]
 *   POST /api/studio/intelligence/subject-requests -> openSubjectRequestHandler     [studio, papel DPO/privacidade]
 *   POST /api/studio/intelligence/subject-requests/:id/{export|suppress|rectify}
 */
import type { Db } from './db.ts';
import { normalizeName } from './normalize.ts';
import {
  getOrganization, getOrgRelations, getPerson, getPersonRoles, listMoveViews, listWatchlistItems, listWatchlists, searchOrganizations,
  searchPeople, type MoveView,
} from './queries.ts';
import { currentPeopleAt, neighbors, shortestPath, type NodeRef } from './graph.ts';
import { getOrgChart } from './repo.ts';
import { reviewMove } from './moves.ts';
import { createWatchlist, listAlerts, reviewAlert, watch } from './watchlists.ts';
import { exportPersonData, openSubjectRequest, rectifyPersonName, suppressPerson } from './subject-requests.ts';

export type Audience = 'public' | 'studio';
export interface ApiResult<T = unknown> { status: number; body: T | { error: { code: string; message: string } } }

const ok = <T>(body: T, status = 200): ApiResult<T> => ({ status, body });
const fail = (status: number, code: string, message: string): ApiResult<never> => ({ status, body: { error: { code, message } } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const today = () => new Date().toISOString().slice(0, 10);

type V<T> = { ok: true; value: T } | { ok: false; res: ApiResult<never> };
function uuid(input: unknown, key: string): V<string> {
  const v = isObj(input) ? input[key] : undefined;
  return typeof v === 'string' && UUID.test(v) ? { ok: true, value: v } : { ok: false, res: fail(400, 'invalid_input', `${key} deve ser UUID`) };
}
function optDate(input: unknown, key: string): V<string> {
  const v = isObj(input) ? input[key] : undefined;
  if (v === undefined) return { ok: true, value: today() };
  if (typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v))) return { ok: true, value: v };
  return { ok: false, res: fail(400, 'invalid_input', `${key} deve ser AAAA-MM-DD`) };
}
function text(input: unknown, key: string, max = 200): V<string> {
  const v = isObj(input) ? input[key] : undefined;
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
    ? { ok: true, value: v.trim() }
    : { ok: false, res: fail(400, 'invalid_input', `${key} é obrigatório (até ${max} caracteres)`) };
}
const optInt = (input: unknown, key: string, def: number, max: number) => {
  const v = isObj(input) ? input[key] : undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : def;
};
/** Inferidas só no Studio e só a pedido; o portal público nunca as recebe. */
const wantInferred = (audience: Audience, input: unknown) => audience === 'studio' && isObj(input) && input.includeInferred === true;

// --------- consultas (portal e Studio) ---------

export async function searchCompaniesHandler(db: Db, input: unknown): Promise<ApiResult> {
  const q = text(input, 'q', 100);
  if (!q.ok) return q.res;
  return ok({ items: await searchOrganizations(db, q.value, optInt(input, 'limit', 20, 100)) });
}

export async function getCompanyHandler(db: Db, audience: Audience, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'id'), asOf = optDate(input, 'asOf');
  if (!id.ok) return id.res;
  if (!asOf.ok) return asOf.res;
  const org = await getOrganization(db, id.value);
  if (!org) return fail(404, 'not_found', 'empresa não encontrada');
  const inferred = wantInferred(audience, input);
  const [people, relations] = await Promise.all([currentPeopleAt(db, id.value, asOf.value), getOrgRelations(db, id.value, asOf.value, inferred)]);
  return ok({
    organization: org,
    as_of: asOf.value,
    people: people.filter((p) => inferred || p.certainty === 'declared'),
    relations,
    // Estado vazio é honesto: lista vazia significa "sem registro", não "sem pessoas".
    notice: 'Dados de fonte pública com data de validação; ausência de registro não prova inexistência.',
  });
}

export async function searchExecutivesHandler(db: Db, input: unknown): Promise<ApiResult> {
  const q = text(input, 'q', 100);
  if (!q.ok) return q.res;
  return ok({ items: await searchPeople(db, q.value, optInt(input, 'limit', 20, 100)) });
}

export async function getExecutiveHandler(db: Db, audience: Audience, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'id');
  if (!id.ok) return id.res;
  const person = await getPerson(db, id.value); // suprimida => null => 404
  if (!person) return fail(404, 'not_found', 'executivo não encontrado');
  const roles = await getPersonRoles(db, id.value, wantInferred(audience, input));
  // Escopo de dado pessoal (DP-11 P4): só nome, cargos e empresas. Nenhum outro campo é exposto.
  return ok({ person: { id: person.id, full_name: person.full_name, public_profile_url: person.public_profile_url, evidence: person.evidence }, roles });
}

export async function getOrgChartHandler(db: Db, audience: Audience, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'organizationId'), asOf = optDate(input, 'asOf');
  if (!id.ok) return id.res;
  if (!asOf.ok) return asOf.res;
  if (!(await getOrganization(db, id.value))) return fail(404, 'not_found', 'empresa não encontrada');
  const edges = await getOrgChart(db, id.value, asOf.value, { includeInferred: wantInferred(audience, input) });
  return ok({ organization_id: id.value, as_of: asOf.value, edges });
}

export async function listMovesHandler(db: Db, audience: Audience, input: unknown): Promise<ApiResult> {
  const f: Parameters<typeof listMoveViews>[1] = { limit: optInt(input, 'limit', 50, 200), offset: optInt(input, 'offset', 0, 100000) };
  if (isObj(input) && input.personId !== undefined) { const p = uuid(input, 'personId'); if (!p.ok) return p.res; f.personId = p.value; }
  if (isObj(input) && input.organizationId !== undefined) { const o = uuid(input, 'organizationId'); if (!o.ok) return o.res; f.organizationId = o.value; }
  if (audience === 'public') f.status = ['confirmed']; // portal: nunca um Move não revisado
  else if (isObj(input) && typeof input.status === 'string') {
    if (!['detected', 'confirmed', 'rejected'].includes(input.status)) return fail(400, 'invalid_input', 'status inválido');
    f.status = [input.status as MoveView['status']];
  }
  return ok({ items: await listMoveViews(db, f) });
}

export async function graphNeighborsHandler(db: Db, audience: Audience, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'id'), asOf = optDate(input, 'asOf');
  const type = isObj(input) ? input.type : undefined;
  if (!id.ok) return id.res;
  if (!asOf.ok) return asOf.res;
  if (type !== 'person' && type !== 'organization') return fail(400, 'invalid_input', 'type deve ser person ou organization');
  const items = await neighbors(db, { type, id: id.value }, { asOf: asOf.value, includeInferred: wantInferred(audience, input), maxHops: optInt(input, 'maxHops', 3, 3) });
  return ok({ items, max_hops: 3 });
}

export async function graphPathHandler(db: Db, audience: Audience, input: unknown): Promise<ApiResult> {
  const asOf = optDate(input, 'asOf');
  if (!asOf.ok) return asOf.res;
  const refs: NodeRef[] = [];
  for (const k of ['from', 'to'] as const) {
    const o = isObj(input) ? input[k] : undefined;
    const id = uuid(o, 'id');
    const t = isObj(o) ? o.type : undefined;
    if (!id.ok || (t !== 'person' && t !== 'organization')) return fail(400, 'invalid_input', `${k} deve ter {type, id}`);
    refs.push({ type: t, id: id.value });
  }
  const path = await shortestPath(db, refs[0]!, refs[1]!, { asOf: asOf.value, includeInferred: wantInferred(audience, input) });
  return ok({ path, max_hops: 3 });
}

// --------- Studio: revisão, watchlists, alertas ---------

export async function reviewMoveHandler(db: Db, actor: string, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'id');
  const s = isObj(input) ? input.status : undefined;
  if (!id.ok) return id.res;
  if (!actor.trim()) return fail(401, 'actor_required', 'identidade do revisor é obrigatória');
  if (s !== 'confirmed' && s !== 'rejected') return fail(400, 'invalid_input', 'status deve ser confirmed ou rejected');
  const cur = await db.query<{ status: string }>(`SELECT status FROM intelligence.move WHERE id = $1`, [id.value]);
  if (!cur.rows[0]) return fail(404, 'not_found', 'move não encontrado');
  if (cur.rows[0].status !== 'detected') return fail(409, 'already_reviewed', 'move já revisado');
  await reviewMove(db, id.value, s);
  return ok({ id: id.value, status: s, reviewed_by: actor });
}

export async function listWatchlistsHandler(db: Db, input: unknown): Promise<ApiResult> {
  const owner = isObj(input) && typeof input.ownerRef === 'string' ? input.ownerRef : undefined;
  return ok({ items: await listWatchlists(db, owner) });
}

export async function createWatchlistHandler(db: Db, actor: string, input: unknown): Promise<ApiResult> {
  const name = text(input, 'name', 120);
  if (!name.ok) return name.res;
  if (!actor.trim()) return fail(401, 'actor_required', 'identidade é obrigatória');
  return ok({ id: await createWatchlist(db, name.value, actor) }, 201);
}

export async function addWatchlistItemHandler(db: Db, input: unknown): Promise<ApiResult> {
  const wl = uuid(input, 'watchlistId'), ent = uuid(input, 'entityId');
  const t = isObj(input) ? input.entityType : undefined;
  if (!wl.ok) return wl.res;
  if (!ent.ok) return ent.res;
  if (t !== 'organization' && t !== 'person') return fail(400, 'invalid_input', 'entityType inválido');
  const exists = t === 'organization' ? await getOrganization(db, ent.value) : await getPerson(db, ent.value);
  if (!exists) return fail(404, 'not_found', 'entidade não encontrada');
  const w = await db.query(`SELECT 1 FROM intelligence.watchlist WHERE id = $1`, [wl.value]);
  if (!w.rows[0]) return fail(404, 'not_found', 'watchlist não encontrada');
  await watch(db, wl.value, t, ent.value);
  return ok({ watchlistId: wl.value, items: await listWatchlistItems(db, wl.value) }, 201);
}

export async function getWatchlistHandler(db: Db, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'id');
  if (!id.ok) return id.res;
  const all = await listWatchlists(db);
  const w = all.find((x) => x.id === id.value);
  if (!w) return fail(404, 'not_found', 'watchlist não encontrada');
  return ok({ watchlist: w, items: await listWatchlistItems(db, id.value) });
}

export async function listAlertsHandler(db: Db, input: unknown): Promise<ApiResult> {
  const f: Parameters<typeof listAlerts>[1] = {};
  if (isObj(input) && input.status !== undefined) {
    if (!['pending_review', 'approved', 'rejected'].includes(String(input.status))) return fail(400, 'invalid_input', 'status inválido');
    f.status = input.status as 'pending_review' | 'approved' | 'rejected';
  }
  if (isObj(input) && input.watchlistId !== undefined) { const w = uuid(input, 'watchlistId'); if (!w.ok) return w.res; f.watchlistId = w.value; }
  return ok({ items: await listAlerts(db, f) });
}

export async function reviewAlertHandler(db: Db, actor: string, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'id');
  const s = isObj(input) ? input.status : undefined;
  if (!id.ok) return id.res;
  if (!actor.trim()) return fail(401, 'actor_required', 'identidade do revisor é obrigatória');
  if (s !== 'approved' && s !== 'rejected') return fail(400, 'invalid_input', 'status deve ser approved ou rejected');
  const cur = await db.query<{ status: string }>(`SELECT status FROM intelligence.alert WHERE id = $1`, [id.value]);
  if (!cur.rows[0]) return fail(404, 'not_found', 'alerta não encontrado');
  if (cur.rows[0].status !== 'pending_review') return fail(409, 'already_reviewed', 'alerta já revisado');
  await reviewAlert(db, id.value, s, actor);
  return ok({ id: id.value, status: s, reviewed_by: actor });
}

// --------- Pedido do titular (WF19) ---------

export async function openSubjectRequestHandler(db: Db, actor: string, input: unknown): Promise<ApiResult> {
  const pid = uuid(input, 'personId');
  const kind = isObj(input) ? input.kind : undefined;
  if (!pid.ok) return pid.res;
  if (!actor.trim()) return fail(401, 'actor_required', 'identidade é obrigatória');
  if (kind !== 'access' && kind !== 'rectification' && kind !== 'suppression') return fail(400, 'invalid_input', 'kind inválido');
  const p = await db.query(`SELECT 1 FROM intelligence.person WHERE id = $1`, [pid.value]);
  if (!p.rows[0]) return fail(404, 'not_found', 'pessoa não encontrada');
  const note = isObj(input) && typeof input.note === 'string' ? input.note.slice(0, 500) : undefined;
  return ok({ id: await openSubjectRequest(db, pid.value, kind, note), status: 'open' }, 201);
}

async function loadRequest(db: Db, id: string) {
  const r = await db.query<{ id: string; person_id: string; kind: string; status: string }>(
    `SELECT id, person_id, kind, status FROM intelligence.data_subject_request WHERE id = $1`, [id]);
  return r.rows[0];
}

export async function exportSubjectDataHandler(db: Db, actor: string, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'requestId');
  if (!id.ok) return id.res;
  if (!actor.trim()) return fail(401, 'actor_required', 'identidade é obrigatória');
  const req = await loadRequest(db, id.value);
  if (!req) return fail(404, 'not_found', 'pedido não encontrado');
  if (req.kind !== 'access') return fail(409, 'wrong_kind', 'pedido não é de acesso');
  const data = await exportPersonData(db, req.person_id);
  await db.query(`UPDATE intelligence.data_subject_request SET status='done', closed_at=now() WHERE id=$1 AND status='open'`, [id.value]);
  return ok({ requestId: id.value, data });
}

export async function suppressSubjectHandler(db: Db, actor: string, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'requestId');
  if (!id.ok) return id.res;
  if (!actor.trim()) return fail(401, 'actor_required', 'identidade é obrigatória');
  const req = await loadRequest(db, id.value);
  if (!req) return fail(404, 'not_found', 'pedido não encontrado');
  if (req.kind !== 'suppression') return fail(409, 'wrong_kind', 'pedido não é de supressão');
  if (req.status !== 'open') return fail(409, 'already_closed', 'pedido já encerrado');
  await suppressPerson(db, id.value, req.person_id, actor);
  return ok({ requestId: id.value, status: 'done' });
}

export async function rectifySubjectHandler(db: Db, actor: string, input: unknown): Promise<ApiResult> {
  const id = uuid(input, 'requestId'), name = text(input, 'fullName', 200);
  if (!id.ok) return id.res;
  if (!name.ok) return name.res;
  if (!actor.trim()) return fail(401, 'actor_required', 'identidade é obrigatória');
  const req = await loadRequest(db, id.value);
  if (!req) return fail(404, 'not_found', 'pedido não encontrado');
  if (req.kind !== 'rectification') return fail(409, 'wrong_kind', 'pedido não é de retificação');
  if (req.status !== 'open') return fail(409, 'already_closed', 'pedido já encerrado');
  await rectifyPersonName(db, id.value, req.person_id, name.value, normalizeName(name.value));
  return ok({ requestId: id.value, status: 'done' });
}
