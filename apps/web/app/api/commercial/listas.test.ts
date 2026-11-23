/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';

// Listas do Studio comercial: GET /api/commercial/studio/campaigns e /studio/accounts (paginadas, com filtros, sem dado pessoal).
let app: Awaited<ReturnType<typeof makeApp>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
const P = (p: string) => `/api/commercial${p}`;
const accounts = new Map<string, string>();
const ids: string[] = [];

async function conta(empresa: string, email: string) {
  const sub = await call(d, 'POST', {
    path: P('/leads'),
    body: { nome: 'Ana Souza', empresa, email, formatosInteresse: ['banners--banner-topo'], objetivo: 'awareness', optInNewsletter: false },
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const inbox = await call(d, 'GET', { path: P('/studio/leads'), as: comercial });
  const lead = inbox.body.find((l: any) => l.email === email.toLowerCase());
  await call(d, 'POST', { path: P('/studio/leads/qualify'), body: { leadId: lead.id }, as: comercial });
  const c = await call(d, 'POST', { path: P('/studio/leads/convert'), body: { leadId: lead.id }, as: comercial });
  expect(c.status).toBe(201);
  accounts.set(empresa, c.body.account.id);
}
async function campanha(name: string, accountId: string, startDate: string, endDate: string) {
  const r = await call(d, 'POST', { path: P('/studio/campaigns'), body: { name, accountId, formatId: 'banners--banner-topo', positionId: 'TOP', startDate, endDate }, as: comercial });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  ids.push(r.body.id);
  return r.body.id as string;
}

beforeAll(async () => {
  app = await makeApp();
  [comercial, admin, editor, leitor] = [await app.actor('comercial'), await app.actor('admin'), await app.actor('editor'), await app.actor('leitor')];
  await conta('Programa Alfa', 'ana@alfa.example');
  await conta('Banco Beta', 'bia@beta.example');
  await conta('Cartão Gama', 'caio@gama.example');
  const alfa = accounts.get('Programa Alfa')!;
  const beta = accounts.get('Banco Beta')!;
  await campanha('Campanha Alfa verão', alfa, '2026-12-01', '2027-03-01');
  await campanha('Campanha Alfa outono', alfa, '2027-03-02', '2027-06-01');
  const c3 = await campanha('Campanha Beta', beta, '2027-01-10', '2027-04-10');
  expect((await call(d, 'POST', { path: P('/studio/campaigns/transition'), body: { campaignId: c3, to: 'cancelled' }, as: comercial })).status).toBe(200);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('GET /api/commercial/studio/campaigns', () => {
  const list = (query: Record<string, string> = {}, as: any = comercial) => call(d, 'GET', { path: P('/studio/campaigns'), query, as });

  it('acesso: sem sessão 401; editor 403; leitor 403 (handler); sessão só de senha MFA_REQUIRED; comercial e admin 200', async () => {
    expect((await call(d, 'GET', { path: P('/studio/campaigns') })).status).toBe(401);
    expect((await list({}, editor)).status).toBe(403);
    expect((await list({}, leitor)).body.error.code).toBe('FORBIDDEN');
    expect((await list({}, await app.passwordOnly('comercial'))).body.error.code).toBe('MFA_REQUIRED');
    expect((await list()).status).toBe(200);
    expect((await list({}, admin)).status).toBe(200);
  });

  it('lista id, nome, estado, formato e período (mais recentes primeiro) com total e paginação', async () => {
    const r = await list();
    expect(r.body).toMatchObject({ total: 3, limit: 20, offset: 0 });
    expect(r.body.data.map((c: any) => c.name)).toEqual(['Campanha Alfa outono', 'Campanha Beta', 'Campanha Alfa verão']);
    expect(r.body.data[2]).toMatchObject({
      id: ids[0], name: 'Campanha Alfa verão', status: 'draft', formatId: 'banners--banner-topo', formatName: expect.any(String), positionId: 'TOP',
      startDate: '2026-12-01', endDate: '2027-03-01', accountId: accounts.get('Programa Alfa'), accountName: 'Programa Alfa', sponsoredLabel: true,
    });
    const p = await list({ limit: '1', offset: '1' });
    expect(p.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(p.body.data.map((c: any) => c.name)).toEqual(['Campanha Beta']);
    expect((await list({ offset: '10' })).body.data).toEqual([]);
  });

  it('filtros: por estado, por conta e por nome; combinados; estado inválido e limites 400', async () => {
    expect((await list({ status: 'draft' })).body.data.map((c: any) => c.name).sort()).toEqual(['Campanha Alfa outono', 'Campanha Alfa verão']);
    expect((await list({ status: 'cancelled' })).body.data.map((c: any) => c.name)).toEqual(['Campanha Beta']);
    expect((await list({ status: 'active' })).body).toMatchObject({ total: 0, data: [] });
    expect((await list({ accountId: accounts.get('Banco Beta')! })).body.total).toBe(1);
    expect((await list({ q: 'ALFA' })).body.total).toBe(2);
    expect((await list({ q: 'alfa', status: 'cancelled' })).body.total).toBe(0);
    for (const bad of <Record<string, string>[]>[{ status: 'inventado' }, { limit: '0' }, { limit: '101' }, { limit: 'x' }, { offset: '-1' }]) {
      const r = await list(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refletem o estado do banco entre requisições (transição aparece na lista)', async () => {
    const t = await call(d, 'POST', { path: P('/studio/campaigns/transition'), body: { campaignId: ids[1], to: 'cancelled' }, as: comercial });
    expect(t.status).toBe(200);
    expect((await list({ status: 'cancelled' })).body.total).toBe(2);
  });

});

describe('GET /api/commercial/studio/accounts', () => {
  const list = (query: Record<string, string> = {}, as: any = comercial) => call(d, 'GET', { path: P('/studio/accounts'), query, as });

  it('acesso: sem sessão 401; editor 403; leitor 403; comercial e admin 200', async () => {
    expect((await call(d, 'GET', { path: P('/studio/accounts') })).status).toBe(401);
    expect((await list({}, editor)).status).toBe(403);
    expect((await list({}, leitor)).status).toBe(403);
    expect((await list()).status).toBe(200);
    expect((await list({}, admin)).status).toBe(200);
  });

  it('lista por nome com contagens (leads, oportunidades, campanhas, ativas) e NUNCA dado pessoal dos leads', async () => {
    const r = await list();
    expect(r.body).toMatchObject({ total: 3, limit: 20, offset: 0 });
    expect(r.body.data.map((a: any) => a.name)).toEqual(['Banco Beta', 'Cartão Gama', 'Programa Alfa']);
    const alfa = r.body.data.find((a: any) => a.name === 'Programa Alfa');
    expect(alfa).toMatchObject({ id: accounts.get('Programa Alfa'), leads: 1, opportunities: 1, campaigns: 2, activeCampaigns: 0 });
    expect(Object.keys(alfa).sort()).toEqual(['activeCampaigns', 'campaigns', 'createdAt', 'id', 'leads', 'name', 'opportunities']);
    const txt = JSON.stringify(r.body);
    for (const pii of ['ana@alfa', 'bia@beta', 'Ana Souza']) expect(txt).not.toContain(pii);
    expect(r.body.data.find((a: any) => a.name === 'Cartão Gama')).toMatchObject({ campaigns: 0, activeCampaigns: 0 });
  });

  it('filtro por nome, paginação e entrada inválida', async () => {
    expect((await list({ q: 'banco' })).body.data.map((a: any) => a.name)).toEqual(['Banco Beta']);
    const p = await list({ limit: '2', offset: '2' });
    expect(p.body).toMatchObject({ total: 3, limit: 2, offset: 2 });
    expect(p.body.data.map((a: any) => a.name)).toEqual(['Programa Alfa']);
    for (const bad of <Record<string, string>[]>[{ limit: '0' }, { limit: '500' }, { offset: '-3' }, { q: 'x'.repeat(101) }]) expect((await list(bad)).status, JSON.stringify(bad)).toBe(400);
  });

  it('as rotas de escrita de mesmo caminho seguem funcionando (POST /studio/campaigns) e métodos errados não existem; POST /studio/accounts cria conta', async () => {
    // POST /studio/accounts passou a existir (criar conta, ft/commercial 4ea7404): corpo vazio é 400, não rota inexistente
    expect((await call(d, 'POST', { path: P('/studio/accounts'), body: {}, as: comercial })).status).toBe(400);
    expect((await call(d, 'DELETE', { path: P('/studio/campaigns'), as: comercial })).status).toBeGreaterThanOrEqual(404);
  });
});

// Por último: cria uma conta e uma campanha próprias (não mexe nas contagens conferidas acima).
describe('GET /api/commercial/studio/campaigns: período e posições', () => {
  const list = (query: Record<string, string> = {}) => call(d, 'GET', { path: P('/studio/campaigns'), query, as: comercial });
  it('período por SOBREPOSIÇÃO (início ≤ to e fim ≥ from, bordas inclusas); positionId; positions em cada linha; datas inválidas 400', async () => {
    const nomes = async (query: Record<string, string>) => (await list(query)).body.data.map((c: any) => c.name).sort();
    // Alfa verão 2026-12-01..2027-03-01 · Alfa outono 2027-03-02..2027-06-01 · Beta 2027-01-10..2027-04-10
    expect(await nomes({ from: '2027-03-01', to: '2027-03-01' })).toEqual(['Campanha Alfa verão', 'Campanha Beta']); // borda do fim inclusa
    expect(await nomes({ from: '2027-03-02' })).toEqual(['Campanha Alfa outono', 'Campanha Beta']);
    expect(await nomes({ to: '2026-12-01' })).toEqual(['Campanha Alfa verão']); // borda do início inclusa
    expect(await nomes({ from: '2027-06-02' })).toEqual([]);
    const r = await list({ from: '2027-01-01', to: '2027-01-31' });
    expect(r.body.total).toBe(r.body.data.length);
    const acc = (await call(d, 'POST', { path: P('/studio/accounts'), body: { name: 'Conta só do teste de posições' }, as: comercial })).body.id as string; // conta própria: não mexe nas contagens das outras
    const multi = await call(d, 'POST', { path: P('/studio/campaigns'), body: { name: 'Gama multi', accountId: acc, formatId: 'banners--banner-rodape', positionIds: ['FOOTER', 'SIDEBAR_1'], startDate: '2027-02-01', endDate: '2027-02-28' }, as: comercial });
    expect(multi.status).toBe(201);
    expect(await nomes({ positionId: 'SIDEBAR_1' })).toEqual(['Gama multi']);
    expect((await nomes({ positionId: 'TOP' })).length).toBe(3);
    const linha = (await list({ positionId: 'FOOTER' })).body.data.find((c: any) => c.name === 'Gama multi');
    expect([linha.positions, linha.positionId]).toEqual([['FOOTER', 'SIDEBAR_1'], 'FOOTER']);
    for (const bad of <Record<string, string>[]>[{ from: '2027-02-30' }, { to: '27-01-01' }, { from: '2027-03-01', to: '2027-02-01' }]) expect((await list(bad)).status).toBe(400);
  });
});
