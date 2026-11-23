import { createApiHttp } from './api-source';
import {
  COMPANY_KINDS, type CompanyDirectory, type CompanyKind, type CompanyListItem, type CompanyLookup, type CompanyProfile, type CompanyRelation,
  type CompanyRelationType, type EvidenceSource, type PortalSource,
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

export type IntelligenceSlice = Pick<PortalSource, 'getCompanyDirectory' | 'getCompany' | 'listCompanies'>;

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

  return {
    getCompanyDirectory,
    getCompany,
    async listCompanies() {
      const d = await getCompanyDirectory();
      return d.status === 'ok' ? d.items.map((c) => ({ slug: c.id, name: c.name, segment: KIND_LABEL[c.kind], lastReviewedAt: c.validatedAt, mock: c.mock })) : [];
    },
  };
}
