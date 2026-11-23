/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp, seedEvidence } from '../_lib/testkit';
import { dispatchEditorial as d } from '../_lib/editorial';

// ADR-019 §c: o caso de correção aceita qualquer articles.id JÁ PUBLICADO (Fábrica ou CMS) pela porta PublishedArticleLookup.
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let ev: string[];

const S = (p: string) => `/api/studio/editorial${p}`;
const PUBLIC = '/api/editorial/right-of-reply';
const open = (articleId: string, over: Record<string, unknown> = {}, as = chefe) =>
  call(d, 'POST', { path: S('/corrections'), body: { articleId, kind: 'erratum', contested: 'Prazo de 12 meses', requester: { name: 'Redação', channel: 'internal' }, ...over }, as });
const intake = (articleId: string) =>
  call(d, 'POST', { path: PUBLIC, body: { articleId, contested: 'trecho contestado da matéria', requester: { name: 'Fulana de Tal', channel: 'form' }, replyText: 'Texto da resposta com mais de dez caracteres.' } });
const caseId = (r: { body: any }): string => r.body.id ?? r.body.correctionId;

async function article(id: string, status: string, over: Record<string, unknown> = {}) {
  await app.db.insert(schema.articles).values({
    id, slug: `materia-${id}`, titulo: `Título ${id}`, editoria: 'pontos', corpo: 'Corpo.', resumo: 'Resumo.', status: status as any, versao: 3,
    publicadoEm: ['publicado', 'corrigido', 'despublicado'].includes(status) ? new Date('2026-11-20T10:00:00Z') : null, ...over,
  } as any);
}

beforeAll(async () => {
  app = await makeApp();
  store = new PgEditorialStore(app.db);
  [chefe, editor] = [await app.actor('editor_chefe'), await app.actor('editor')];
  ev = await seedEvidence(app.db, 3);
  await article('cms-pub', 'publicado');
  await article('cms-cor', 'corrigido');
  await article('cms-off', 'despublicado');
  for (const st of ['rascunho', 'em_checagem', 'aprovado', 'bloqueado']) await article(`cms-${st}`, st);
  await article('fab-pub', 'publicado');
  await store.putArticle(sampleArticle('fab-pub', { status: 'publicado' }));
  await app.db.insert(schema.articleSources).values({ articleId: 'cms-pub', evidenceId: ev[0]! });
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('abertura de caso sobre articles publicado', () => {
  it('matéria SÓ do CMS (sem registro editorial) abre caso; guarda slug, versão publicada e origem cms', async () => {
    const r = await open('cms-pub');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rec = await store.getCorrection(caseId(r));
    expect(rec?.case).toMatchObject({ articleId: 'cms-pub', articleVersao: 3, articleOrigem: 'cms', state: 'received' });
    expect(rec?.articleSlug).toBe('materia-cms-pub');
  });

  it('matéria da Fábrica (existe editorial_article com o mesmo id) tem origem fabrica', async () => {
    const r = await open('fab-pub');
    expect(r.status).toBe(201);
    expect((await store.getCorrection(caseId(r)))?.case).toMatchObject({ articleOrigem: 'fabrica', articleVersao: 3 });
  });

  it('corrigido e despublicado também abrem caso (o leitor viu a página)', async () => {
    expect((await open('cms-cor')).status).toBe(201);
    expect((await open('cms-off')).status).toBe(201);
  });

  it('rascunho, em checagem, aprovado, bloqueado e inexistente: 404 NOT_FOUND com a MESMA mensagem (não revela se o rascunho existe)', async () => {
    const msgs = new Set<string>();
    for (const id of ['cms-rascunho', 'cms-em_checagem', 'cms-aprovado', 'cms-bloqueado', 'nao-existe']) {
      const r = await open(id);
      expect(r.status, id).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
      msgs.add(r.body.error.message);
      const p = await intake(id);
      expect(p.status, `intake ${id}`).toBe(404);
      msgs.add(p.body.error.message);
    }
    expect(msgs.size).toBe(1);
  });

  it('intake público (sem sessão) pela mesma porta: matéria só do CMS abre; resposta sem contato', async () => {
    const r = await intake('cms-pub');
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(['correctionId', 'state']);
    expect((await store.getCorrection(r.body.correctionId))?.case.articleOrigem).toBe('cms');
  });

  it('só papel de gestão abre caso pelo Studio', async () => {
    expect((await open('cms-pub', {}, editor)).status).toBe(403);
  });
});

describe('preservação de evidência e verificação da errata', () => {
  it('sem URL: usa NEXT_PUBLIC_SITE_URL + /noticia/{slug}; sem a variável e sem URL ⇒ 400', async () => {
    const id = caseId(await open('cms-pub'));
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const semBase = await call(d, 'POST', { path: S(`/corrections/${id}/preserve-evidence`), body: { body: 'html da página publicada' }, as: chefe });
    expect(semBase.status).toBe(400);
    process.env.NEXT_PUBLIC_SITE_URL = 'https://loyaltynews.example/';
    try {
      const ok = await call(d, 'POST', { path: S(`/corrections/${id}/preserve-evidence`), body: { body: 'html da página publicada' }, as: chefe });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await store.getCorrection(id))?.case.archive?.url).toBe('https://loyaltynews.example/noticia/materia-cms-pub');
    } finally {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
  });

  async function evidenciaPreservada(articleId: string, over: Record<string, unknown> = {}) {
    const o = await open(articleId, over);
    expect(o.status).toBe(201);
    const id = caseId(o);
    expect((await call(d, 'POST', { path: S(`/corrections/${id}/preserve-evidence`), body: { url: 'https://loyaltynews.example/materias/x', body: 'pagina' }, as: chefe })).status).toBe(200);
    return id;
  }
  const triar = (id: string, claims: unknown[]) =>
    call(d, 'POST', { path: S(`/corrections/${id}/triage`), body: { accepted: true, reason: 'Procede.', corrected: 'Prazo de 24 meses', claims }, as: chefe });

  it('matéria do CMS: a evidência ligada em article_sources sustenta a errata (claim de fato)', async () => {
    const id = await evidenciaPreservada('cms-pub');
    const r = await triar(id, [{ id: 'k1', text: 'o prazo é de 24 meses', kind: 'fact', evidenceIds: [ev[0]] }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await store.getCorrection(id))?.case.state).toBe('accepted');
  });

  it('evidência que não é da matéria nem foi apontada no caso ⇒ bloqueada, e o caso não avança', async () => {
    const id = await evidenciaPreservada('cms-pub');
    const r = await triar(id, [{ id: 'k1', text: 'o prazo é de 24 meses', kind: 'fact', evidenceIds: [ev[1]] }]);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await store.getCorrection(id))?.case.state).toBe('evidence_preserved');
  });

  it('evidência de apoio apontada no caso (supportingEvidenceIds) entra na verificação mesmo sem estar ligada à matéria', async () => {
    const id = await evidenciaPreservada('cms-pub', { supportingEvidenceIds: [ev[2]] });
    const r = await triar(id, [{ id: 'k1', text: 'o prazo é de 24 meses', kind: 'fact', evidenceIds: [ev[2]] }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('CMS guarda só URL e hash da evidência, sem texto: número e citação literal NÃO são verificáveis (falha fechada)', async () => {
    const id = await evidenciaPreservada('cms-pub');
    expect((await triar(id, [{ id: 'k1', text: 'o prazo é de 24 meses', kind: 'number', evidenceIds: [ev[0]] }])).status).toBeGreaterThanOrEqual(400);
    expect((await triar(id, [{ id: 'k2', text: 'fala', kind: 'quote', evidenceIds: [ev[0]], quote: { text: 'texto literal', speaker: 'Pessoa' } }])).status).toBeGreaterThanOrEqual(400);
    expect((await store.getCorrection(id))?.case.state).toBe('evidence_preserved');
  });

  it('errata aceita sem claims com evidência não é aceita', async () => {
    const id = await evidenciaPreservada('cms-pub');
    const r = await call(d, 'POST', { path: S(`/corrections/${id}/triage`), body: { accepted: true, reason: 'Procede.', corrected: 'x', claims: [] }, as: chefe });
    expect(r.status).toBe(400);
  });
});
