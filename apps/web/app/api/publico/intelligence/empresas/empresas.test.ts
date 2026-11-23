/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEvidence, addOrgRelation, addRole, resolveOrCreatePerson, upsertOrganization } from '@ln/intelligence';
import { call, makeApp } from '../../../_lib/testkit';
import { intelDb } from '../../../_lib/intelligence';
import * as lista from './route';
import * as detalhe from './[id]/route';

// Leitura pública do Intelligence para o Portal (contrato v1 do Frontend 2): sem login, só relações declaradas e vigentes, nunca
// excerpt/hash, pessoas só com a flag intelligencePessoas.
let app: Awaited<ReturnType<typeof makeApp>>;
let ids: Record<string, string>;
const T = '2026-11-01T00:00:00Z';
const get = (query: Record<string, string> = {}) => call(lista.GET, 'GET', { path: '/api/publico/intelligence/empresas', query });
const one = (id: string) => call(detalhe.GET, 'GET', { path: `/api/publico/intelligence/empresas/${id}`, params: { id } });

beforeAll(async () => {
  app = await makeApp();
  const db = intelDb(app.db);
  const ev = (nome: string, extra: Record<string, unknown> = {}) =>
    addEvidence(db, { sourceUrl: `https://${nome}.example.invalid/imprensa`, sourceName: `MOCK ${nome}`, retrievedAt: T, isMock: true, excerpt: 'trecho que nunca pode sair', contentHash: 'h'.repeat(64), ...extra } as any);
  const org = async (legalName: string, kind: string, tradeName?: string) => upsertOrganization(db, { legalName, tradeName, kind, evidenceId: await ev(legalName.toLowerCase().replace(/\W+/g, '-')), observedAt: T });
  const livelo = await org('Livelo S.A.', 'program', 'Livelo');
  const uber = await org('Uber do Brasil Ltda', 'company', 'Uber');
  const abemf = await org('Associação Alfa', 'association');
  const anatel = await org('Agência Reguladora Beta', 'regulator');
  const relEv = await ev('relacao-1');
  const rel = (from: string, to: string, type: any, extra: Record<string, unknown> = {}) =>
    addOrgRelation(db, { fromOrgId: from, toOrgId: to, type, validFrom: '2026-01-01', evidenceId: relEv, observedAt: T, validatedAt: T, ...extra } as any);
  await rel(livelo, uber, 'partner_of');
  await rel(abemf, livelo, 'coalition_member');
  await rel(livelo, anatel, 'other', { validFrom: '2020-01-01', validTo: '2021-01-01' }); // encerrada: não vigente
  await rel(uber, abemf, 'other', { certainty: 'inferred', inferenceBasis: 'heurística' }); // inferida: nunca no público
  const ana = (await resolveOrCreatePerson(db, { fullName: 'MOCK Ana Teste', organizationId: livelo, evidenceId: await ev('ana'), observedAt: T }, { personIngestion: true, extendedPersonalData: false } as any)).id;
  await addRole(db, { personId: ana, organizationId: livelo, title: 'CEO', validFrom: '2024-01-01', evidenceId: await ev('cargo-ana'), observedAt: T });
  ids = { livelo, uber, abemf, anatel, ana };
}, 180_000);
afterAll(async () => {
  app.deps.flags.intelligencePessoas = false;
  await app.close();
});

describe('GET /api/publico/intelligence/empresas', () => {
  it('sem login; lista por nome (fantasia ou legal), com total, contagem por tipo e relações declaradas vigentes', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: any) => x.nome)).toEqual(['Agência Reguladora Beta', 'Associação Alfa', 'Livelo', 'Uber']);
    expect(r.body.total).toBe(4);
    expect(r.body.tipos).toEqual([{ tipo: 'association', total: 1 }, { tipo: 'company', total: 1 }, { tipo: 'program', total: 1 }, { tipo: 'regulator', total: 1 }]);
    const livelo = r.body.data.find((x: any) => x.id === ids.livelo);
    expect(livelo).toEqual({ id: ids.livelo, nome: 'Livelo', nomeLegal: 'Livelo S.A.', tipo: 'program', relacoes: 2, validadoEm: '2026-11-01T00:00:00.000Z', mock: true });
    expect(r.body.data.find((x: any) => x.id === ids.anatel).relacoes).toBe(0); // a única relação dela já terminou
    expect(r.body.data.find((x: any) => x.id === ids.uber).relacoes).toBe(1); // a inferida não conta
  });

  it('filtros: tipo, q (nome, case-insensitive, sem curinga), paginação; `tipos` ignora o filtro de tipo mas respeita o q', async () => {
    expect((await get({ tipo: 'program' })).body.data.map((x: any) => x.nome)).toEqual(['Livelo']);
    expect((await get({ tipo: 'program' })).body.tipos).toHaveLength(4);
    expect((await get({ q: 'uBeR' })).body.data.map((x: any) => x.nome)).toEqual(['Uber']);
    expect((await get({ q: 'uber' })).body.tipos).toEqual([{ tipo: 'company', total: 1 }]);
    expect((await get({ q: '%' })).body.total).toBe(0); // % é texto, não curinga
    const p1 = await get({ limit: '2' });
    const p2 = await get({ limit: '2', offset: '2' });
    expect([p1.body.data.length, p2.body.data.length, p1.body.total]).toEqual([2, 2, 4]);
    expect([...p1.body.data, ...p2.body.data].map((x: any) => x.nome)).toEqual(['Agência Reguladora Beta', 'Associação Alfa', 'Livelo', 'Uber']);
  });

  it('parâmetros inválidos: 400 invalid_input (tipo fora da lista, limite, offset, q longo)', async () => {
    for (const q of [{ tipo: 'inventado' }, { limit: '0' }, { limit: '101' }, { offset: '-1' }, { q: 'x'.repeat(101) }] as Record<string, string>[]) {
      const r = await get(q);
      expect(r.status, JSON.stringify(q)).toBe(400);
      expect(r.body.error.code).toBe('invalid_input');
    }
  });

  it('nunca expõe excerpt, hash de conteúdo nem a citação, em nenhuma das rotas', async () => {
    const todos = JSON.stringify([(await get()).body, (await one(ids.livelo!)).body]);
    expect(todos).not.toMatch(/trecho que nunca pode sair|excerpt|content_hash|contentHash|quote/);
    expect(todos).not.toContain('h'.repeat(64));
  });
});

describe('GET /api/publico/intelligence/empresas/:id', () => {
  it('empresa com fonte e relações declaradas vigentes nos dois sentidos, sem inferidas nem encerradas', async () => {
    const r = await one(ids.livelo!);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({ id: ids.livelo, nome: 'Livelo', nomeLegal: 'Livelo S.A.', tipo: 'program', mock: true });
    expect(d.fonte).toEqual({ nome: 'MOCK livelo-s-a-', url: 'https://livelo-s-a-.example.invalid/imprensa', coletadoEm: '2026-11-01T00:00:00.000Z' });
    expect(d.relacoes.map((x: any) => [x.tipo, x.sentido, x.empresa.nome, x.empresa.tipo])).toEqual([
      ['coalition_member', 'destino', 'Associação Alfa', 'association'],
      ['partner_of', 'origem', 'Uber', 'company'],
    ]);
    expect(d.relacoes[1]).toMatchObject({ vigenteDesde: '2026-01-01', validadoEm: '2026-11-01T00:00:00.000Z', mock: true });
    expect(d.relacoes[1].fonte).toMatchObject({ nome: 'MOCK relacao-1', url: 'https://relacao-1.example.invalid/imprensa' });
    expect(Object.keys(d.relacoes[1].fonte).sort()).toEqual(['coletadoEm', 'nome', 'url']);
  });

  it('pessoas: com a flag desligada (estado atual) disponivel=false e itens vazios, mesmo havendo cargo no banco; ligada, só nome/cargo/fonte', async () => {
    app.deps.flags.intelligencePessoas = false;
    expect((await one(ids.livelo!)).body.data.pessoas).toEqual({ disponivel: false, itens: [] });
    expect(JSON.stringify((await one(ids.livelo!)).body)).not.toContain('Ana');
    app.deps.flags.intelligencePessoas = true;
    const p = (await one(ids.livelo!)).body.data.pessoas;
    expect(p.disponivel).toBe(true);
    expect(p.itens).toHaveLength(1);
    expect(p.itens[0]).toMatchObject({ nome: 'MOCK Ana Teste', cargo: 'CEO', vigenteDesde: '2024-01-01', mock: true });
    expect(Object.keys(p.itens[0]).sort()).toEqual(['cargo', 'fonte', 'id', 'mock', 'nome', 'validadoEm', 'vigenteDesde']);
    app.deps.flags.intelligencePessoas = false;
  });

  it('id inválido: 400; inexistente: 404 not_found', async () => {
    expect((await one('nao-e-uuid')).body.error.code).toBe('invalid_input');
    expect((await one('00000000-0000-4000-8000-000000000000'))).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
  });

  it('cache público de 60 s nas duas rotas', async () => {
    expect((await get()).headers.get('cache-control')).toMatch(/public, max-age=60/);
    expect((await one(ids.livelo!)).headers.get('cache-control')).toMatch(/public, max-age=60/);
  });
});
