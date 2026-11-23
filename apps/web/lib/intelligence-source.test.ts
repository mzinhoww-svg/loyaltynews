import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createIntelligenceSlice, filterDirectory, mapCompany, mapCompanyItem, mapRelation, relationLabel,
} from '../app/(portal)/_lib/intelligence-source';
import { emptySource } from '../app/(portal)/_lib/empty-source';
import { mockSource } from '../app/(portal)/_lib/fixtures/portal.mock';

// Payloads no formato de fast-track/decisoes/contrato-publico-intelligence-portal.md.
const ID = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fonte = { nome: 'Fonte de teste', url: 'https://fonte.invalid/p', coletadoEm: '2026-11-23T00:00:00.000Z' };
const item = (n: number, tipo: string, nome = `Org ${n}`) => ({ id: ID(n), nome, nomeLegal: nome, tipo, relacoes: n % 3, validadoEm: '2026-11-23T00:00:00.000Z', mock: false });
const relacao = (over: Record<string, unknown> = {}) => ({
  id: ID(90), tipo: 'partner_of', sentido: 'origem', empresa: { id: ID(2), nome: 'Banco', tipo: 'company' },
  vigenteDesde: '2026-11-23', validadoEm: '2026-11-23T00:00:00.000Z', fonte, quote: 'trecho literal', ...over,
});
const empresa = (over: Record<string, unknown> = {}) => ({
  id: ID(1), nome: 'Livelo', nomeLegal: 'Livelo S.A.', tipo: 'company', fonte, relacoes: [relacao()], pessoas: { disponivel: false, itens: [] }, ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('mapeamento do contrato', () => {
  it('item válido; tipo desconhecido ou data inválida é descartado', () => {
    expect(mapCompanyItem(item(1, 'program'))).toMatchObject({ id: ID(1), kind: 'program', relationCount: 1 });
    expect(mapCompanyItem(item(1, 'banco'))).toBeNull();
    expect(mapCompanyItem({ ...item(1, 'company'), validadoEm: 'ontem' })).toBeNull();
    expect(mapCompanyItem(null)).toBeNull();
  });

  it('relação sem fonte não é publicada; o trecho literal nunca é copiado', () => {
    const r = mapRelation(relacao());
    expect(r).toMatchObject({ direction: 'from', type: 'partner_of', source: { name: 'Fonte de teste', url: 'https://fonte.invalid/p' } });
    expect(JSON.stringify(r)).not.toContain('trecho literal');
    expect(mapRelation(relacao({ fonte: null }))).toBeNull();
    expect(mapRelation(relacao({ fonte: { ...fonte, url: 'javascript:alert(1)' } }))).toBeNull();
    expect(mapRelation(relacao({ sentido: 'lado' }))).toBeNull();
  });

  it('empresa: relações inválidas saem, ordem por nome, pessoas indisponíveis com a flag desligada', () => {
    const c = mapCompany(empresa({ relacoes: [relacao({ empresa: { id: ID(3), nome: 'Zeta', tipo: 'other' } }), relacao(), { lixo: true }] }));
    expect(c?.relations.map((r) => r.other.name)).toEqual(['Banco', 'Zeta']);
    expect(c?.peopleAvailable).toBe(false);
    expect(mapCompany(empresa({ fonte: undefined }))).toBeNull();
  });

  it('rótulo da relação depende do sentido', () => {
    expect(relationLabel({ type: 'parent_of', direction: 'from' })).toBe('Controla');
    expect(relationLabel({ type: 'parent_of', direction: 'to' })).toBe('Controlada por');
    expect(relationLabel({ type: 'other', direction: 'to' })).toBe('Vínculo declarado com');
  });

  it('filtro por tipo mantém a contagem de todos os tipos; busca ignora acento', () => {
    const all = [item(1, 'company', 'Ônibus'), item(2, 'company', 'Banco'), item(3, 'other', 'Clube')].map((i) => mapCompanyItem(i)!);
    const d = filterDirectory(all, { kind: 'company' });
    expect(d.items.map((i) => i.name)).toEqual(['Banco', 'Ônibus']);
    expect(d.kinds).toEqual([{ kind: 'company', total: 2 }, { kind: 'other', total: 1 }]);
    expect(filterDirectory(all, { q: 'onibus' }).items).toHaveLength(1);
  });
});

describe('createIntelligenceSlice (HTTP)', () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => err.mockRestore());

  it('lista e filtra por tipo localmente', async () => {
    const f = vi.fn(async () => json(200, { data: [item(1, 'company'), item(2, 'other'), { id: 'x' }], total: 3, tipos: [] }));
    const s = createIntelligenceSlice('http://api.test/', f as unknown as typeof fetch);
    const d = await s.getCompanyDirectory({ kind: 'other', q: ' org ' });
    expect(f).toHaveBeenCalledWith('http://api.test/api/publico/intelligence/empresas?limit=100&q=org', expect.anything());
    expect(d).toMatchObject({ status: 'ok', total: 1, kinds: [{ kind: 'company', total: 1 }, { kind: 'other', total: 1 }] });
  });

  it.each([
    ['status 503', async () => json(503, { error: {} })],
    ['formato inválido', async () => json(200, { data: 'x' })],
    ['rede', async () => { throw new TypeError('fetch failed'); }],
  ])('falha (%s) vira indisponível, nunca vazio', async (_n, impl) => {
    const s = createIntelligenceSlice('http://api.test', vi.fn(impl) as unknown as typeof fetch);
    expect(await s.getCompanyDirectory()).toEqual({ status: 'unavailable' });
    expect(await s.getCompany(ID(1))).toEqual({ status: 'unavailable' });
    expect(await s.listCompanies()).toEqual([]);
  });

  it('empresa: 404 é não encontrada; id fora do formato nem chega à API', async () => {
    const f = vi.fn(async () => json(404, { error: { code: 'not_found' } }));
    const s = createIntelligenceSlice('http://api.test', f as unknown as typeof fetch);
    expect(await s.getCompany(ID(1))).toEqual({ status: 'not_found' });
    expect(await s.getCompany('../../materias')).toEqual({ status: 'not_found' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('empresa válida', async () => {
    const s = createIntelligenceSlice('http://api.test', (async () => json(200, { data: empresa() })) as unknown as typeof fetch);
    const r = await s.getCompany(ID(1));
    expect(r.status === 'ok' && r.company.relations[0]?.other.name).toBe('Banco');
  });
});

describe('fontes vazia e MOCK', () => {
  it('vazia: diretório vazio honesto e empresa inexistente', async () => {
    expect(await emptySource.getCompanyDirectory()).toEqual({ status: 'ok', items: [], total: 0, kinds: [] });
    expect(await emptySource.getCompany(ID(1))).toEqual({ status: 'not_found' });
  });

  it('MOCK: tudo rotulado e as relações apontam para empresas existentes', async () => {
    const d = await mockSource.getCompanyDirectory();
    if (d.status !== 'ok') throw new Error('mock indisponível');
    expect(d.items.every((c) => c.mock && c.name.includes('MOCK'))).toBe(true);
    for (const c of d.items) {
      const r = await mockSource.getCompany(c.id);
      if (r.status !== 'ok') throw new Error(c.id);
      for (const rel of r.company.relations) expect((await mockSource.getCompany(rel.other.id)).status).toBe('ok');
      expect(r.company.source.url).toMatch(/\.invalid\//);
    }
  });
});
