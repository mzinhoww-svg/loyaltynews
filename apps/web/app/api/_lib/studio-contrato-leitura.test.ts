// CONTRATO DE LEITURA DO STUDIO - rotas reais (fast-track, item E).
// As telas de leitura do Studio chamam estes handlers em processo (`lib/studio/backend.ts`), com a sessao do usuario.
// O teste chama os MESMOS handlers com a sessao real (Better Auth + MFA) sobre o banco de teste e confere:
//   - nunca 5xx (o criterio do PM: zero 5xx);
//   - o envelope de lista que a tela le (`data` ou `items`) existe;
//   - cada item, quando houver, tem os campos que a tela imprime.
// Banco vazio de proposito: o que se prova aqui e o contrato, nao o conteudo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeApp, type Actor } from './testkit';
import * as materias from '../materias/route';
import * as fontes from '../fontes/route';
import * as midia from '../midia/route';
import * as agenda from '../agenda/route';
import * as creativeCards from '../studio/creative/cards/route';
import * as siteRedirects from '../site/redirects/route';
import * as intelligence from '../intelligence/[...path]/route';
import * as pilotoLinhas from '../studio/openbot/piloto/linhas/route';
import * as commercial from '../commercial/[...path]/route';
import * as titular from '../studio/correcoes/[[...path]]/route';

type Handler = Parameters<typeof call>[0];

interface Caso {
  /** Tela do Studio que le este endpoint. */
  tela: string;
  rota: string;
  handler: Handler;
  /** Caminho passado ao handler (quando o dispatch depende da URL). */
  path: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** Envelope de lista que a tela le. */
  envelope: 'data' | 'items';
  /** Campo de identificacao de cada item. */
  id: string;
  /** Campos que a tela imprime em cada item. */
  campos: string[];
}

const CASOS: Caso[] = [
  { tela: '/studio/cms', rota: '/api/materias', handler: materias.GET, path: '/api/materias', envelope: 'data', id: 'id', campos: ['titulo', 'status', 'editoria'] },
  { tela: '/studio/fontes', rota: '/api/fontes', handler: fontes.GET, path: '/api/fontes', envelope: 'data', id: 'id', campos: ['nome', 'url', 'tipo'] },
  { tela: '/studio/midia', rota: '/api/midia', handler: midia.GET, path: '/api/midia', envelope: 'data', id: 'id', campos: ['tipo', 'direitos'] },
  { tela: '/studio/agenda', rota: '/api/agenda', handler: agenda.GET, path: '/api/agenda', envelope: 'data', id: 'id', campos: ['titulo', 'inicio', 'local'] },
  { tela: '/studio/creative', rota: '/api/studio/creative/cards', handler: creativeCards.GET, path: '/api/studio/creative/cards', envelope: 'data', id: 'id', campos: ['estado', 'kind', 'format'] },
  { tela: '/studio/seo', rota: '/api/site/redirects', handler: siteRedirects.GET, path: '/api/site/redirects', envelope: 'data', id: 'id', campos: ['de', 'para', 'status'] },
  { tela: '/studio/entidades', rota: '/api/studio/intelligence/companies', handler: intelligence.GET, path: '/api/studio/intelligence/companies', query: { q: 'a' }, envelope: 'items', id: 'id', campos: ['legal_name', 'kind'] },
  { tela: '/studio/crm (moves)', rota: '/api/studio/intelligence/moves', handler: intelligence.GET, path: '/api/studio/intelligence/moves', envelope: 'items', id: 'id', campos: ['kind', 'status', 'person_name'] },
  { tela: '/studio/watchlists', rota: '/api/studio/intelligence/watchlists', handler: intelligence.GET, path: '/api/studio/intelligence/watchlists', envelope: 'items', id: 'id', campos: ['name', 'owner_ref'] },
  { tela: '/studio/piloto/violacoes', rota: '/api/studio/openbot/piloto/linhas', handler: pilotoLinhas.GET, path: '/api/studio/openbot/piloto/linhas', envelope: 'items', id: 'taskId', campos: ['attempt', 'violacoes'] },
  { tela: '/studio/crm (contas)', rota: '/api/commercial/studio/accounts', handler: commercial.GET, path: '/api/commercial/studio/accounts', envelope: 'data', id: 'id', campos: ['nome'] },
  { tela: '/studio/campanhas', rota: '/api/commercial/studio/campaigns', handler: commercial.GET, path: '/api/commercial/studio/campaigns', envelope: 'data', id: 'id', campos: ['nome', 'status'] },
  { tela: '/studio/correcoes-titular', rota: '/api/studio/correcoes', handler: titular.GET, path: '/api/studio/correcoes', envelope: 'items', id: 'id', campos: ['estado', 'prazoEm'] },
];

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;

beforeAll(async () => {
  app = await makeApp();
  admin = await app.actor('admin');
});

afterAll(async () => {
  await app.close();
});

describe('contrato de leitura do Studio - rotas reais, banco vazio', () => {
  for (const caso of CASOS) {
    it(`${caso.rota} (${caso.tela}) nao devolve 5xx e mantem o envelope da tela`, async () => {
      const r = await call(caso.handler, 'GET', { path: caso.path, as: admin, params: caso.params, query: caso.query });
      expect(r.status, `${caso.rota} status ${r.status} body ${JSON.stringify(r.body)?.slice(0, 300)}`).toBeLessThan(500);
      expect(r.status).toBeLessThan(400);
      expect(r.body?.error).toBeUndefined();
      const lista = r.body?.[caso.envelope];
      expect(Array.isArray(lista), `${caso.rota}: envelope "${caso.envelope}" ausente`).toBe(true);
      for (const item of lista as Record<string, unknown>[]) {
        expect(item, `${caso.rota}: item sem "${caso.id}"`).toHaveProperty(caso.id);
        for (const campo of caso.campos) expect(item, `${caso.rota}: item sem "${campo}"`).toHaveProperty(campo);
      }
    });
  }

  it('com uma linha em cada colecao principal, os campos que a tela imprime chegam', async () => {
    // Semeia pelos proprios endpoints (nao por INSERT direto): o contrato de entrada e o de saida sao os reais.
    const ed = await app.actor('editor');
    const uuid = () => crypto.randomUUID();
    const fonteId = uuid();

    const m = await call(materias.POST, 'POST', { path: '/api/materias', as: ed, body: { slug: `contrato-${Date.now()}`, titulo: 'Materia do contrato', editoria: 'pontos', corpo: 'Corpo da materia do contrato.' } });
    expect(m.status, `POST /api/materias: ${m.status} ${JSON.stringify(m.body)?.slice(0, 200)}`).toBe(201);

    const f = await call(fontes.POST, 'POST', { path: '/api/fontes', as: ed, body: { id: fonteId, nome: 'Fonte do contrato', url: 'https://example.org/fonte', tipo: 'site', editorias: ['pontos'] } });
    expect(f.status, `POST /api/fontes: ${f.status} ${JSON.stringify(f.body)?.slice(0, 200)}`).toBe(201);

    const a = await call(agenda.POST, 'POST', { path: '/api/agenda', as: ed, body: { titulo: 'Evento do contrato', inicio: '2026-12-01', fim: '2026-12-01', local: 'Sao Paulo', fonteUrl: 'https://example.org/evento' } });
    expect(a.status, `POST /api/agenda: ${a.status} ${JSON.stringify(a.body)?.slice(0, 200)}`).toBe(201);

    const w = await call(intelligence.POST, 'POST', { path: '/api/studio/intelligence/watchlists', as: ed, body: { name: 'Lista do contrato' } });
    expect(w.status, `POST watchlists: ${w.status} ${JSON.stringify(w.body)?.slice(0, 200)}`).toBe(201);

    // Agora cada leitura precisa trazer os campos que a tela imprime naquela linha.
    const casos = [
      { rota: '/api/materias', r: await call(materias.GET, 'GET', { path: '/api/materias', as: admin }), envelope: 'data', campos: ['titulo', 'status', 'editoria'], esperado: 'Materia do contrato' },
      { rota: '/api/fontes', r: await call(fontes.GET, 'GET', { path: '/api/fontes', as: admin }), envelope: 'data', campos: ['nome', 'url', 'tipo'], esperado: 'Fonte do contrato' },
      { rota: '/api/agenda', r: await call(agenda.GET, 'GET', { path: '/api/agenda', as: admin }), envelope: 'data', campos: ['titulo', 'inicio', 'local'], esperado: 'Evento do contrato' },
      { rota: '/api/studio/intelligence/watchlists', r: await call(intelligence.GET, 'GET', { path: '/api/studio/intelligence/watchlists', as: ed }), envelope: 'items', campos: ['name', 'owner_ref'], esperado: 'Lista do contrato' },
    ] as const;

    for (const caso of casos) {
      const lista = (caso.r.body as Record<string, unknown>)[caso.envelope] as Record<string, unknown>[];
      expect(Array.isArray(lista), `${caso.rota}: envelope ausente`).toBe(true);
      const linha = lista.find((i) => Object.values(i).includes(caso.esperado));
      expect(linha, `${caso.rota}: a linha semeada nao voltou na leitura`).toBeTruthy();
      for (const campo of caso.campos) expect(linha, `${caso.rota}: linha sem "${campo}"`).toHaveProperty(campo);
    }
  });

  it('sem sessao a leitura e negada (401/403), nunca 5xx nem dado vazado', async () => {
    for (const caso of CASOS) {
      const r = await call(caso.handler, 'GET', { path: caso.path, as: null, params: caso.params });
      expect([401, 403], `${caso.rota} sem sessao: ${r.status}`).toContain(r.status);
      expect(r.body?.data).toBeUndefined();
      expect(r.body?.items).toBeUndefined();
    }
  });
});
