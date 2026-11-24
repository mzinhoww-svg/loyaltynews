/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
// CONTRATO fake-api × rotas reais (fast-track/ociosidade [A5], Backend 3). O e2e do portal roda contra apps/web/e2e/fake-api.mjs (MOCK);
// se o fake responder diferente da API real (status, código de erro, campos), o e2e passa e a produção quebra — foi o que gerou as
// ressalvas do QA 4 (800b0eb) e do QA 8. Esta suíte sobe o fake de verdade (processo node) e chama os handlers reais (banco de teste) com
// as MESMAS requisições, e compara: status, `error.code` e o conjunto de chaves (topo e do primeiro item quando os dois têm itens).
// Divergência conhecida e ainda não corrigida no fake fica em `KNOWN` com o motivo: o caso roda como `it.fails` (a suíte continua verde) e
// passa a FALHAR quando o fake for alinhado — aí é só tirar a linha de KNOWN. Divergência nova falha na hora.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp } from './testkit';
import * as materias from '../publico/materias/route';
import * as materia from '../publico/materias/[slug]/route';
import * as agenda from '../publico/agenda/route';
import * as evento from '../publico/agenda/[id]/route';
import * as site from '../publico/site/route';
import * as pessoas from '../publico/intelligence/pessoas/route';
import * as pessoa from '../publico/intelligence/pessoas/[id]/route';
import * as moves from '../publico/intelligence/moves/route';
import * as move from '../publico/intelligence/moves/[id]/route';
import * as empresas from '../publico/intelligence/empresas/route';
import * as empresa from '../publico/intelligence/empresas/[id]/route';
import * as adPlan from '../commercial/ads/plan/route';

type Handler = Parameters<typeof call>[0];
interface Case {
  name: string;
  path: string;
  query?: Record<string, string>;
  real: Handler;
  params?: Record<string, string>;
  /** Comparar as chaves do 1º item de `data` (lista) ou de `data` (detalhe). */
  item?: 'list' | 'detail';
}

const CASES: Case[] = [
  // matérias: validação (400 × 422 era a divergência do QA 4) e formato
  { name: 'materias: lista sem filtro', path: '/api/publico/materias', real: materias.GET, item: 'list' },
  { name: 'materias: tipo válido', path: '/api/publico/materias', query: { tipo: 'flash' }, real: materias.GET },
  { name: 'materias: tipo inválido', path: '/api/publico/materias', query: { tipo: 'inventado' }, real: materias.GET },
  { name: 'materias: tipo vazio', path: '/api/publico/materias', query: { tipo: '' }, real: materias.GET },
  { name: 'materias: q com 101 caracteres', path: '/api/publico/materias', query: { q: 'x'.repeat(101) }, real: materias.GET },
  { name: 'materias: q com 100 caracteres e espaços nas pontas', path: '/api/publico/materias', query: { q: ` ${'x'.repeat(100)} ` }, real: materias.GET },
  { name: 'materias: q só com espaços', path: '/api/publico/materias', query: { q: '   ' }, real: materias.GET },
  { name: 'materias: limit 0', path: '/api/publico/materias', query: { limit: '0' }, real: materias.GET },
  { name: 'materias: limit 101', path: '/api/publico/materias', query: { limit: '101' }, real: materias.GET },
  { name: 'materias: offset negativo', path: '/api/publico/materias', query: { offset: '-1' }, real: materias.GET },
  { name: 'materias: editoria inexistente', path: '/api/publico/materias', query: { editoria: 'nao-existe' }, real: materias.GET },
  { name: 'materia: slug inexistente', path: '/api/publico/materias/nao-existe', real: materia.GET, params: { slug: 'nao-existe' } },
  // agenda
  { name: 'agenda: lista', path: '/api/publico/agenda', real: agenda.GET },
  { name: 'agenda: evento inexistente', path: '/api/publico/agenda/nao-existe', real: evento.GET, params: { id: 'nao-existe' } },
  // site (home)
  { name: 'site: home', path: '/api/publico/site', real: site.GET },
  // Intelligence (público)
  { name: 'intelligence: pessoas', path: '/api/publico/intelligence/pessoas', real: pessoas.GET },
  { name: 'intelligence: pessoa inexistente (UUID válido)', path: '/api/publico/intelligence/pessoas/00000000-0000-4000-8000-00000000dead', real: pessoa.GET, params: { id: '00000000-0000-4000-8000-00000000dead' } },
  { name: 'intelligence: pessoa com id malformado', path: '/api/publico/intelligence/pessoas/nao-e-uuid', real: pessoa.GET, params: { id: 'nao-e-uuid' } },
  { name: 'intelligence: moves', path: '/api/publico/intelligence/moves', real: moves.GET },
  { name: 'intelligence: move inexistente (UUID válido)', path: '/api/publico/intelligence/moves/00000000-0000-4000-8000-00000000dead', real: move.GET, params: { id: '00000000-0000-4000-8000-00000000dead' } },
  { name: 'intelligence: move com id malformado', path: '/api/publico/intelligence/moves/nao-e-uuid', real: move.GET, params: { id: 'nao-e-uuid' } },
  { name: 'intelligence: empresas', path: '/api/publico/intelligence/empresas', real: empresas.GET },
  { name: 'intelligence: empresa inexistente (UUID válido)', path: '/api/publico/intelligence/empresas/00000000-0000-4000-8000-00000000dead', real: empresa.GET, params: { id: '00000000-0000-4000-8000-00000000dead' } },
  { name: 'intelligence: empresa com id malformado', path: '/api/publico/intelligence/empresas/nao-e-uuid', real: empresa.GET, params: { id: 'nao-e-uuid' } },
  // plano de anúncios
  { name: 'ads: plano', path: '/api/commercial/ads/plan', query: { positions: 'TOP,FOOTER' }, real: adPlan.GET },
];

/**
 * Divergências conhecidas no fake da main, ainda não corrigidas (o caso roda como it.fails). Quem alinhar o fake tira a linha daqui.
 * Fonte: parecer do QA 4 r0-preparacao/qa/qa4-portal-fe-800b0eb.md. Tipo e q de matérias saíram daqui quando o fake foi alinhado
 * (ft/portal-polish-fe 9120163, na int/013+); a Intelligence sai quando ft/portal-intelligence 6c1bbbb entrar.
 */
// int/015: tipo e q de matérias saíram da lista porque o fake da int/014 já está alinhado nesses casos (os 5 passaram a reprovar como it.fails).
const KNOWN: Record<string, string> = {
  'materias: limit 0': 'fake não valida limit (200), API 400 (1–100)',
  'materias: limit 101': 'fake não valida limit (200), API 400 (1–100)',
  'materias: offset negativo': 'fake não valida offset (200), API 400',
  'materias: editoria inexistente': 'fake devolve lista vazia (200), API 400 (editoria fora do catálogo)',
  'intelligence: pessoa com id malformado': 'fake 404 not_found, API 400 invalid_input (id deve ser UUID)',
  'intelligence: move com id malformado': 'fake 404 not_found, API 400 invalid_input (id deve ser UUID)',
  'intelligence: empresa inexistente (UUID válido)': 'fake usa NOT_FOUND maiúsculo, API not_found',
  'intelligence: empresa com id malformado': 'fake 404 NOT_FOUND, API 400 invalid_input (id deve ser UUID)',
};

let app: Awaited<ReturnType<typeof makeApp>>;
let fake: ChildProcess;
let port = 0;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

beforeAll(async () => {
  app = await makeApp();
  // dado real mínimo e público, para comparar as chaves do item da lista
  await app.db.insert(schema.articles).values({ id: 'c1', slug: 'contrato-1', titulo: 'Contrato 1', resumo: 'Resumo', corpo: 'x', editoria: 'pontos', tipoConteudo: 'flash', status: 'publicado', publicadoEm: new Date('2026-11-20T10:00:00Z'), classeDeDado: 'public' } as any);
  port = await freePort();
  const file = fileURLToPath(new URL('../../../e2e/fake-api.mjs', import.meta.url));
  fake = spawn(process.execPath, [file], { env: { ...process.env, FAKE_API_PORT: String(port), FAKE_API_STATUS: '' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('fake-api não subiu');
}, 180_000);
afterAll(async () => {
  fake?.kill();
  await app?.close();
});

const keys = (o: unknown): string[] | string => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort() : typeof o);
const firstItem = (b: any, item: Case['item']) => (item === 'list' ? (Array.isArray(b?.data) && b.data.length ? b.data[0] : undefined) : item === 'detail' ? b?.data : undefined);

async function both(c: Case) {
  const url = new URL(`http://127.0.0.1:${port}${c.path}`);
  for (const [k, v] of Object.entries(c.query ?? {})) url.searchParams.set(k, v);
  const fr = await fetch(url);
  const fb = (await fr.text()) || 'null';
  const r = await call(c.real, 'GET', { path: c.path, query: c.query, params: c.params });
  return { fake: { status: fr.status, body: JSON.parse(fb) }, real: { status: r.status, body: r.body } };
}

describe('contrato fake-api.mjs × rotas reais', () => {
  for (const c of CASES) {
    const run = async () => {
      const { fake: f, real: r } = await both(c);
      const summary = (x: { status: number; body: any }) => ({ status: x.status, code: x.status >= 400 ? (x.body?.error?.code ?? null) : null, top: keys(x.body) });
      const fs = summary(f);
      const rs = summary(r);
      // no erro compara status e código (o real acrescenta requestId ao envelope; a mensagem é livre)
      if (rs.status >= 400) rs.top = 'erro';
      if (fs.status >= 400) fs.top = 'erro';
      expect(fs, `fake diverge da API real em "${c.name}": fake=${JSON.stringify(fs)} real=${JSON.stringify(rs)}`).toEqual(rs);
      const fi = firstItem(f.body, c.item);
      const ri = firstItem(r.body, c.item);
      if (fi !== undefined && ri !== undefined) expect(keys(fi), `campos do item divergem em "${c.name}"`).toEqual(keys(ri));
    };
    if (KNOWN[c.name]) it.fails(`${c.name} — DIVERGÊNCIA CONHECIDA: ${KNOWN[c.name]}`, run, 60_000);
    else it(c.name, run, 60_000);
  }

  it('toda divergência conhecida aponta para um caso que existe', () => {
    for (const k of Object.keys(KNOWN)) expect(CASES.map((c) => c.name)).toContain(k);
  });
});
