/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import { SEED_SOURCES, type ArticleRecord } from '@ln/editorial';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import * as recibosRoute from '../materias/[id]/recibos/route';
import * as fontes from '../fontes/route';
import * as fonte from '../fontes/[id]/route';

// ADR-019 §d: dois cadastros de fontes ligados por id. Linha 'fabrica' é projeção do registro e somente leitura no CMS.
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;

const FABRICA = SEED_SOURCES[0]!; // id do registro da Fábrica (ex.: azul-ri)

function approvedFrom(id: string, sourceId: string): ArticleRecord {
  const a = sampleArticle(id, { status: 'aprovado' });
  a.evidences = a.evidences.map((e) => ({ ...e, id: `ev-${id}`, sourceId, text: 'Texto MOCK. Nas palavras de Pessoa MOCK: texto literal.' }));
  a.draft = { ...a.draft!, evidenceIds: [`ev-${id}`], claims: a.draft!.claims.map((c) => ({ ...c, evidenceIds: [`ev-${id}`] })) };
  a.factcheck = { provider: 'anthropic', model: 'mock', verdicts: a.draft.claims.map((c) => ({ claimId: c.id, verdict: 'pass' as const })) };
  return a;
}
const rcpt = (id: string) => call(recibosRoute.POST, 'POST', { params: { id }, body: { checagens: [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }] }, as: chefe });
const source = async (id: string) => (await app.db.select().from(schema.sources).where(eq(schema.sources.id, id)))[0];

beforeAll(async () => {
  app = await makeApp({ publicacaoPortal: true });
  store = new PgEditorialStore(app.db);
  [chefe, editor] = [await app.actor('editor_chefe'), await app.actor('editor')];
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('ADR-019 §d: fontes ligadas por id', () => {
  it('o registro da Fábrica tem fontes e o padrão de `sources.origem` é cms', async () => {
    expect(SEED_SOURCES.length).toBeGreaterThan(0);
    const c = await call(fontes.POST, 'POST', { body: { id: 'manual-1', nome: 'Fonte manual', url: 'https://example.org/m', tipo: 'site', editorias: ['mercado'] }, as: editor });
    expect(c.status).toBe(201);
    expect(c.body.data.origem).toBe('cms');
  });

  it('POST /api/fontes com id do registro da Fábrica ⇒ 409 ID_RESERVED, nada gravado', async () => {
    const r = await call(fontes.POST, 'POST', { body: { id: FABRICA.id, nome: 'Impostora', url: 'https://example.org/i', tipo: 'site', editorias: ['mercado'] }, as: editor });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ID_RESERVED');
    expect(await source(FABRICA.id)).toBeUndefined();
  });

  it('a projeção do recibo grava origem=fabrica com o MESMO id, nome e URL do registro; o CMS lista e lê, mas PATCH e DELETE ⇒ 409 FACTORY_SOURCE_READONLY', async () => {
    await store.putArticle(approvedFrom('fo-1', FABRICA.id));
    expect((await rcpt('fo-1')).status).toBe(201);
    const row = await source(FABRICA.id);
    expect(row).toMatchObject({ id: FABRICA.id, origem: 'fabrica', nome: FABRICA.name, ativo: false, termosRevisados: false });
    const lista = await call(fontes.GET, 'GET', { as: editor });
    expect(lista.body.data.find((s: any) => s.id === FABRICA.id).origem).toBe('fabrica');
    expect((await call(fonte.GET, 'GET', { params: { id: FABRICA.id }, as: editor })).body.data.origem).toBe('fabrica');
    for (const body of [{ ativo: true, termosRevisados: true }, { nome: 'Outro nome' }]) {
      const p = await call(fonte.PATCH, 'PATCH', { params: { id: FABRICA.id }, body, as: chefe });
      expect(p.status, JSON.stringify(body)).toBe(409);
      expect(p.body.error.code).toBe('FACTORY_SOURCE_READONLY');
    }
    const d = await call(fonte.DELETE, 'DELETE', { params: { id: FABRICA.id }, as: chefe });
    expect(d.status).toBe(409);
    expect(d.body.error.code).toBe('FACTORY_SOURCE_READONLY');
    expect(await source(FABRICA.id)).toMatchObject({ origem: 'fabrica', ativo: false });
    // fonte do CMS continua editável
    expect((await call(fonte.PATCH, 'PATCH', { params: { id: 'manual-1' }, body: { nome: 'Manual renomeada' }, as: editor })).status).toBe(200);
  });

  it('a próxima projeção reescreve nome e URL a partir do registro (só em linha fabrica)', async () => {
    await app.db.update(schema.sources).set({ nome: 'alterada por fora', url: 'https://alterada.example' }).where(eq(schema.sources.id, FABRICA.id));
    await store.putArticle(approvedFrom('fo-2', FABRICA.id));
    expect((await rcpt('fo-2')).status).toBe(201);
    expect(await source(FABRICA.id)).toMatchObject({ nome: FABRICA.name, origem: 'fabrica' });
  });

  it('linha cms com o mesmo id de uma fonte citada pela Fábrica ⇒ 409 SOURCE_ID_CONFLICT, a transação inteira é desfeita e a linha cms não muda', async () => {
    await app.db.insert(schema.sources).values({ id: 'fonte-colide', nome: 'Manual colidente', url: 'https://example.org/c', tipo: 'site', acesso: 'publico', origem: 'cms' });
    await store.putArticle(approvedFrom('fo-3', 'fonte-colide'));
    const r = await rcpt('fo-3');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SOURCE_ID_CONFLICT');
    expect(await source('fonte-colide')).toMatchObject({ origem: 'cms', nome: 'Manual colidente' });
    expect((await app.db.select().from(schema.articles).where(eq(schema.articles.id, 'fo-3'))).length).toBe(0);
    expect((await app.db.select().from(schema.publicationReceipts).where(eq(schema.publicationReceipts.articleId, 'fo-3'))).length).toBe(0);
    expect((await app.db.select().from(schema.evidences).where(eq(schema.evidences.id, 'ev-fo-3'))).length).toBe(0);
  });

  it('o Studio nunca liga coleta por /api/fontes: ativo/termosRevisados do CMS valem só para citação manual (fonte fabrica não aceita)', async () => {
    const on = await call(fonte.PATCH, 'PATCH', { params: { id: FABRICA.id }, body: { termosRevisados: true, ativo: true }, as: chefe });
    expect(on.status).toBe(409);
    expect((await source(FABRICA.id))?.ativo).toBe(false);
  });
});
