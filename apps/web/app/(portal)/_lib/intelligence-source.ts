import { createApiHttp } from './api-source';
import {
  COMPANY_KINDS, type CompanyDirectory, type CompanyKind, type CompanyListItem, type CompanyLookup, type CompanyProfile, type CompanyRelation,
  type CompanyRelationType, type EvidenceSource, type MoveEntry, type MoveKind, type MoveLookup, type MoveReading, type MovesFeed,
  type PeopleDirectory, type PersonListItem, type PersonLookup, type PersonProfile, type PersonRole, type PortalSource,
} from './types';

/**
 * Adaptador `api` do Entity Intelligence: lê `/api/publico/intelligence/empresas[/:id]` (contrato em
 * fast-track/decisoes/contrato-publico-intelligence-portal.md). Só fato declarado, com fonte, link e data; nunca o trecho literal.
 * Falha da API (rede, timeout, status, formato) vira `unavailable`: a página diz que o diretório está indisponível, sem 500
 * e sem fingir que não há empresas. Item fora do formato é descartado.
 */

export const KIND_LABEL: Record<CompanyKind, string> = {
  company: 'Empresa',
  program: 'Programa de fidelidade',
  association: 'Associação',
  regulator: 'Regulador',
  media: 'Mídia',
  other: 'Tipo não declarado na fonte',
};
export const KIND_FILTER_LABEL: Record<CompanyKind, string> = { ...KIND_LABEL, other: 'Outros (tipo não declarado)' };

const REL: Record<CompanyRelationType, { from: string; to: string }> = {
  partner_of: { from: 'Parceria anunciada com', to: 'Parceria anunciada com' },
  parent_of: { from: 'Controla', to: 'Controlada por' },
  supplier_of: { from: 'Fornecedora de', to: 'Cliente de' },
  coalition_member: { from: 'Integra a coalizão', to: 'Coalizão que inclui' },
  acquired: { from: 'Adquiriu', to: 'Adquirida por' },
  other: { from: 'Vínculo declarado com', to: 'Vínculo declarado com' },
};
const REL_TYPES = Object.keys(REL) as CompanyRelationType[];

/** Rótulo da relação do ponto de vista da empresa da página. */
export const relationLabel = (r: Pick<CompanyRelation, 'type' | 'direction'>) => REL[r.type][r.direction];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCompanyId = (v: string) => UUID.test(v);
export const asKind = (v: unknown): CompanyKind | undefined => (COMPANY_KINDS.includes(v as CompanyKind) ? (v as CompanyKind) : undefined);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isHttps = (v: unknown): v is string => {
  if (!isStr(v)) return false;
  try {
    return ['https:', 'http:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

export function mapSource(v: unknown): EvidenceSource | null {
  if (!isObj(v) || !isStr(v.nome) || !isHttps(v.url) || !isDate(v.coletadoEm)) return null;
  return { name: v.nome, url: v.url, retrievedAt: v.coletadoEm };
}

export function mapCompanyItem(v: unknown): CompanyListItem | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.nome) || !isDate(v.validadoEm)) return null;
  const kind = asKind(v.tipo);
  if (!kind) return null;
  const n = typeof v.relacoes === 'number' && Number.isInteger(v.relacoes) && v.relacoes >= 0 ? v.relacoes : 0;
  return { id: v.id, name: v.nome, legalName: isStr(v.nomeLegal) ? v.nomeLegal : v.nome, kind, relationCount: n, validatedAt: v.validadoEm, mock: v.mock === true };
}

export function mapRelation(v: unknown): CompanyRelation | null {
  if (!isObj(v) || !isStr(v.id) || !REL_TYPES.includes(v.tipo as CompanyRelationType)) return null;
  if (v.sentido !== 'origem' && v.sentido !== 'destino') return null;
  const e = v.empresa;
  if (!isObj(e) || !isStr(e.id) || !isStr(e.nome)) return null;
  const source = mapSource(v.fonte);
  if (!source || !isDate(v.validadoEm) || !isDate(v.vigenteDesde)) return null; // sem fonte não publica
  return {
    id: v.id,
    type: v.tipo as CompanyRelationType,
    direction: v.sentido === 'origem' ? 'from' : 'to',
    other: { id: e.id, name: e.nome, kind: asKind(e.tipo) ?? 'other' },
    validFrom: v.vigenteDesde,
    validatedAt: v.validadoEm,
    source,
    mock: v.mock === true,
  };
}

export function mapCompany(v: unknown): CompanyProfile | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.nome)) return null;
  const kind = asKind(v.tipo);
  const source = mapSource(v.fonte);
  if (!kind || !source) return null;
  const relations = (Array.isArray(v.relacoes) ? v.relacoes : []).map(mapRelation).filter((r): r is CompanyRelation => r !== null);
  relations.sort((a, b) => a.other.name.localeCompare(b.other.name, 'pt-BR'));
  const pessoas = isObj(v.pessoas) ? v.pessoas : {};
  return {
    id: v.id, name: v.nome, legalName: isStr(v.nomeLegal) ? v.nomeLegal : v.nome, kind, source, relations,
    peopleAvailable: pessoas.disponivel === true, mock: v.mock === true,
  };
}

/** Filtro e contagem por tipo sobre uma lista já carregada (usado pelo MOCK e como reforço do filtro da API). */
export function filterDirectory(all: CompanyListItem[], filter: { kind?: CompanyKind; q?: string } = {}): Extract<CompanyDirectory, { status: 'ok' }> {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = filter.q ? norm(filter.q.trim()) : '';
  const byText = q ? all.filter((c) => norm(`${c.name} ${c.legalName}`).includes(q)) : all;
  const kinds = COMPANY_KINDS.map((kind) => ({ kind, total: byText.filter((c) => c.kind === kind).length })).filter((k) => k.total > 0);
  const items = (filter.kind ? byText.filter((c) => c.kind === filter.kind) : byText).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { status: 'ok', items, total: items.length, kinds };
}

// ---------- pessoas, cargos e Moves (contrato-publico-intelligence-pessoas-moves.md) ----------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v));
const ref = (v: unknown): { id: string; name: string } | null => (isObj(v) && isStr(v.id) && isStr(v.nome) ? { id: v.id, name: v.nome } : null);

export const MOVE_KIND_LABEL: Record<MoveKind, string> = {
  appointment: 'Nomeação',
  departure: 'Saída',
  title_change: 'Mudança de cargo',
  org_change: 'Mudança de empresa',
};
const MOVE_KINDS = Object.keys(MOVE_KIND_LABEL) as MoveKind[];

export function mapRole(v: unknown): PersonRole | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.titulo) || !isDay(v.vigenteDesde) || !isDate(v.validadoEm)) return null;
  const company = ref(v.empresa);
  const source = mapSource(v.fonte);
  if (!company || !source) return null;
  if (v.vigenteAte != null && !isDay(v.vigenteAte)) return null;
  return {
    id: v.id, title: v.titulo, company, validFrom: v.vigenteDesde, validTo: (v.vigenteAte as string | null) ?? null, validatedAt: v.validadoEm, source,
    ...(isStr(v.periodo) ? { periodText: v.periodo.slice(0, 120) } : {}),
    ...(v.corrigidoPeloTitular === true ? { correctedByHolder: true } : {}),
    mock: v.mock === true,
  };
}

export function mapReading(v: unknown): MoveReading | null {
  if (!isObj(v) || !isStr(v.titulo) || !isDay(v.vigenteDesde) || !isDate(v.validadoEm)) return null;
  const company = ref(v.empresa);
  const source = mapSource(v.fonte);
  if (!company || !source) return null;
  return { title: v.titulo, company, validFrom: v.vigenteDesde, validTo: isDay(v.vigenteAte) ? v.vigenteAte : null, validatedAt: v.validadoEm, source };
}

/**
 * Move do portal. Regra do MOVES_MODEL: Move = duas leituras com evidência. Sem a evidência exigida pelo tipo (antes E depois na
 * mudança; antes na saída; depois na nomeação), o item é descartado: nunca publicamos mudança sem a prova de cada lado.
 */
export function mapMove(v: unknown): MoveEntry | null {
  if (!isObj(v) || !isStr(v.id) || !MOVE_KINDS.includes(v.tipo as MoveKind) || !isDay(v.observadoEm)) return null;
  if (v.base !== 'announcement' && v.base !== 'observed_diff') return null;
  const person = ref(v.pessoa);
  if (!person) return null;
  const before = v.antes == null ? null : mapReading(v.antes);
  const after = v.depois == null ? null : mapReading(v.depois);
  if ((v.antes != null && !before) || (v.depois != null && !after)) return null;
  const kind = v.tipo as MoveKind;
  const needs = { title_change: [true, true], org_change: [true, true], departure: [true, false], appointment: [false, true] }[kind];
  if ((needs[0] && !before) || (needs[1] && !after)) return null;
  return {
    id: v.id, kind, basis: v.base, person, effectiveDate: isDay(v.dataEfetiva) ? v.dataEfetiva : null, observedOn: v.observadoEm,
    before, after, mock: v.mock === true,
  };
}

export function mapPersonItem(v: unknown): PersonListItem | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.nome)) return null;
  // A rota já manda só os vigentes (fim nulo OU no futuro): o portal não refiltra, para não esconder cargo com fim futuro.
  const roles = (Array.isArray(v.cargos) ? v.cargos : []).map(mapRole).filter((r): r is PersonRole => r !== null);
  return { id: v.id, name: v.nome, roles, ...(v.corrigidoPeloTitular === true ? { correctedByHolder: true } : {}), mock: v.mock === true };
}

export function mapPerson(v: unknown): PersonProfile | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.nome)) return null;
  const source = mapSource(v.fonte);
  if (!source) return null;
  const roles = (k: string) => (Array.isArray(v[k]) ? (v[k] as unknown[]) : []).map(mapRole).filter((r): r is PersonRole => r !== null);
  const moves = (Array.isArray(v.moves) ? v.moves : []).map(mapMove).filter((m): m is MoveEntry => m !== null);
  return {
    id: v.id, name: v.nome, profileUrl: isHttps(v.perfilPublico) ? v.perfilPublico : null, source,
    currentRoles: roles('cargosAtuais'), history: roles('historico'), moves: sortMoves(moves),
    ...(v.corrigidoPeloTitular === true ? { correctedByHolder: true } : {}), mock: v.mock === true,
  };
}

export const sortMoves = (m: MoveEntry[]) => m.slice().sort((a, b) => b.observedOn.localeCompare(a.observedOn) || a.person.name.localeCompare(b.person.name, 'pt-BR'));

export type IntelligenceSlice = Pick<
  PortalSource,
  'getCompanyDirectory' | 'getCompany' | 'listCompanies' | 'getPeopleDirectory' | 'getPerson' | 'getMovesFeed' | 'getMove'
>;

export function createIntelligenceSlice(baseUrl: string, fetchImpl: typeof fetch = fetch): IntelligenceSlice {
  const { get, logFalha } = createApiHttp(baseUrl, fetchImpl);
  const WHAT = 'intelligence';

  async function getCompanyDirectory(filter: { kind?: CompanyKind; q?: string } = {}): Promise<CompanyDirectory> {
    const qs = new URLSearchParams({ limit: '100' });
    const q = filter.q?.trim().slice(0, 100);
    if (q) qs.set('q', q);
    const res = await get(`/api/publico/intelligence/empresas?${qs}`, WHAT);
    if (!res) return { status: 'unavailable' };
    if (!res.ok) {
      logFalha(WHAT, `status ${res.status}`);
      return { status: 'unavailable' };
    }
    try {
      const j = (await res.json()) as { data?: unknown };
      if (!Array.isArray(j.data)) throw new Error('formato');
      const items = j.data.map(mapCompanyItem).filter((c): c is CompanyListItem => c !== null);
      if (items.length < j.data.length) logFalha(WHAT, `${j.data.length - items.length} item(ns) inválido(s) descartado(s)`);
      // O filtro de tipo é aplicado aqui sobre a lista inteira: assim a contagem de cada tipo nos chips é sempre consistente.
      return filterDirectory(items, { kind: filter.kind });
    } catch {
      logFalha(WHAT, 'resposta inválida');
      return { status: 'unavailable' };
    }
  }

  async function getCompany(id: string): Promise<CompanyLookup> {
    if (!isCompanyId(id)) return { status: 'not_found' };
    const res = await get(`/api/publico/intelligence/empresas/${encodeURIComponent(id)}`, WHAT);
    if (!res) return { status: 'unavailable' };
    if (res.status === 404 || res.status === 400) return { status: 'not_found' };
    if (!res.ok) {
      logFalha(WHAT, `status ${res.status}`);
      return { status: 'unavailable' };
    }
    try {
      const company = mapCompany(((await res.json()) as { data?: unknown }).data);
      if (!company) throw new Error('formato');
      return { status: 'ok', company };
    } catch {
      logFalha(WHAT, 'resposta inválida');
      return { status: 'unavailable' };
    }
  }

  /** Lista com envelope { data, total, disponivel }: falha = unavailable; item fora do formato é descartado. */
  async function list<T>(path: string, map: (v: unknown) => T | null): Promise<{ status: 'ok'; items: T[]; total: number; available: boolean } | { status: 'unavailable' }> {
    const res = await get(path, WHAT);
    if (!res) return { status: 'unavailable' };
    if (!res.ok) {
      logFalha(WHAT, `status ${res.status}`);
      return { status: 'unavailable' };
    }
    try {
      const j = (await res.json()) as { data?: unknown; disponivel?: unknown };
      if (!Array.isArray(j.data) || typeof j.disponivel !== 'boolean') throw new Error('formato');
      const items = j.data.map(map).filter((x): x is T => x !== null);
      if (items.length < j.data.length) logFalha(WHAT, `${j.data.length - items.length} item(ns) inválido(s) descartado(s)`);
      // Com a flag desligada nada é exibido, mesmo que a resposta traga itens.
      return j.disponivel ? { status: 'ok', items, total: items.length, available: true } : { status: 'ok', items: [], total: 0, available: false };
    } catch {
      logFalha(WHAT, 'resposta inválida');
      return { status: 'unavailable' };
    }
  }

  /**
   * `invalidIsNotFound`: para Moves, um item que chega com id mas fora do modelo (ex.: mudança sem a leitura "antes") não é
   * publicado: responde 404, como Move inexistente — nunca "indisponível", que sugeriria tentar de novo.
   */
  async function one<T>(path: string, id: string, map: (v: unknown) => T | null, invalidIsNotFound = false): Promise<{ status: 'ok'; value: T } | { status: 'not_found' } | { status: 'unavailable' }> {
    if (!isCompanyId(id)) return { status: 'not_found' };
    const res = await get(`${path}/${encodeURIComponent(id)}`, WHAT);
    if (!res) return { status: 'unavailable' };
    if (res.status === 404 || res.status === 400) return { status: 'not_found' };
    if (!res.ok) {
      logFalha(WHAT, `status ${res.status}`);
      return { status: 'unavailable' };
    }
    try {
      const data = ((await res.json()) as { data?: unknown }).data;
      const value = map(data);
      if (!value && invalidIsNotFound && isObj(data) && data.id === id) {
        logFalha(WHAT, 'item fora do modelo descartado');
        return { status: 'not_found' };
      }
      if (!value) throw new Error('formato');
      return { status: 'ok', value };
    } catch {
      logFalha(WHAT, 'resposta inválida');
      return { status: 'unavailable' };
    }
  }

  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ limit: '100' });
    for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
    return p.toString();
  };

  return {
    getCompanyDirectory,
    getCompany,
    async getPeopleDirectory(filter = {}): Promise<PeopleDirectory> {
      const empresa = filter.companyId && isCompanyId(filter.companyId) ? filter.companyId : undefined;
      const r = await list(`/api/publico/intelligence/pessoas?${qs({ q: filter.q?.trim().slice(0, 100), empresa })}`, mapPersonItem);
      if (r.status !== 'ok') return r;
      return { ...r, items: r.items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) };
    },
    async getPerson(id): Promise<PersonLookup> {
      const r = await one('/api/publico/intelligence/pessoas', id, mapPerson);
      return r.status === 'ok' ? { status: 'ok', person: r.value } : r;
    },
    async getMovesFeed(filter = {}): Promise<MovesFeed> {
      const ok = (v?: string) => (v && isCompanyId(v) ? v : undefined);
      const r = await list(`/api/publico/intelligence/moves?${qs({ empresa: ok(filter.companyId), pessoa: ok(filter.personId) })}`, mapMove);
      return r.status === 'ok' ? { ...r, items: sortMoves(r.items) } : r;
    },
    async getMove(id): Promise<MoveLookup> {
      const r = await one('/api/publico/intelligence/moves', id, mapMove, true);
      return r.status === 'ok' ? { status: 'ok', move: r.value } : r;
    },
    async listCompanies() {
      const d = await getCompanyDirectory();
      return d.status === 'ok' ? d.items.map((c) => ({ slug: c.id, name: c.name, segment: KIND_LABEL[c.kind], lastReviewedAt: c.validatedAt, mock: c.mock })) : [];
    },
  };
}
