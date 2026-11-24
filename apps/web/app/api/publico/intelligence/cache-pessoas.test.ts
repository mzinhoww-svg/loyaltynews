import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEvidence, addRole, resolveOrCreatePerson, upsertOrganization } from '@ln/intelligence';
import { call, makeApp } from '../../_lib/testkit';
import { intelDb } from '../../_lib/intelligence';
import * as pessoas from './pessoas/route';
import * as pessoa from './pessoas/[id]/route';
import * as moves from './moves/route';
import * as empresas from './empresas/route';
import * as empresa from './empresas/[id]/route';

// PM-2026-11-23-O (achado (c) do QA 1, DP-38): resposta com pessoa nunca em cache compartilhado; empresa sem pessoa mantém o cache curto.
let app: Awaited<ReturnType<typeof makeApp>>;
let ids: { org: string; pessoa: string };
const T = '2026-11-01T00:00:00Z';
const NO_STORE = 'private, no-store';
const cc = (r: { headers: Headers }) => r.headers.get('cache-control');
const flag = async <R>(on: boolean, fn: () => Promise<R>): Promise<R> => {
  app.deps.flags.intelligencePessoas = on;
  try {
    return await fn();
  } finally {
    app.deps.flags.intelligencePessoas = false;
  }
};

beforeAll(async () => {
  app = await makeApp();
  const db = intelDb(app.db);
  const ev = async (u: string) => addEvidence(db, { sourceUrl: u, sourceName: 'MOCK RI', retrievedAt: T, isMock: true } as never);
  const org = await upsertOrganization(db, { legalName: 'Alfa Cache S.A.', evidenceId: await ev('https://ri.alfa.example.invalid/'), observedAt: T });
  const p = (await resolveOrCreatePerson(db, { fullName: 'MOCK Ana Cache', organizationId: org, evidenceId: await ev('https://ri.alfa.example.invalid/ana'), observedAt: T }, { personIngestion: true, extendedPersonalData: false } as never)).id;
  await addRole(db, { personId: p, organizationId: org, title: 'CEO', validFrom: '2024-01-01', evidenceId: await ev('https://ri.alfa.example.invalid/ceo'), observedAt: T } as never);
  ids = { org, pessoa: p };
}, 180_000);
afterAll(async () => app.close());

describe('cache das rotas públicas do Intelligence', () => {
  it('pessoas, moves e detalhe de pessoa: private, no-store (com a flag ligada e também desligada)', async () => {
    for (const on of [true, false]) {
      await flag(on, async () => {
        expect(cc(await call(pessoas.GET, 'GET', { path: '/api/publico/intelligence/pessoas' }))).toBe(NO_STORE);
        expect(cc(await call(moves.GET, 'GET', { path: '/api/publico/intelligence/moves' }))).toBe(NO_STORE);
      });
    }
    const r = await flag(true, () => call(pessoa.GET, 'GET', { path: `/api/publico/intelligence/pessoas/${ids.pessoa}`, params: { id: ids.pessoa } }));
    expect(r.status).toBe(200);
    expect(cc(r)).toBe(NO_STORE);
    expect(cc(r)).not.toMatch(/public|max-age|stale-while-revalidate/);
  });

  it('empresa: lista mantém o cache curto; detalhe com pessoas (flag ligada) é no-store e sem pessoas (flag desligada) mantém o cache curto', async () => {
    expect(cc(await call(empresas.GET, 'GET', { path: '/api/publico/intelligence/empresas' }))).toMatch(/^public, max-age=60/);
    const um = () => call(empresa.GET, 'GET', { path: `/api/publico/intelligence/empresas/${ids.org}`, params: { id: ids.org } });
    const com = await flag(true, um);
    expect(com.status).toBe(200);
    expect(com.body.data.pessoas.disponivel).toBe(true);
    expect(cc(com)).toBe(NO_STORE);
    const sem = await flag(false, um);
    expect(sem.body.data.pessoas.disponivel).toBe(false);
    expect(cc(sem)).toMatch(/^public, max-age=60/);
  });

  it('páginas do portal que mostram pessoa são force-dynamic (sem revalidate que guarde a versão antiga)', () => {
    const base = new URL('../../../(portal)/', import.meta.url);
    for (const p of ['intelligence/pessoas/page.tsx', 'intelligence/pessoas/[id]/page.tsx', 'moves/page.tsx', 'moves/[id]/page.tsx', 'intelligence/empresas/[id]/page.tsx']) {
      const src = readFileSync(new URL(p, base), 'utf8');
      expect(src, p).toMatch(/export const dynamic = 'force-dynamic'/);
      expect(src, p).not.toMatch(/export const revalidate/);
    }
  });
});
