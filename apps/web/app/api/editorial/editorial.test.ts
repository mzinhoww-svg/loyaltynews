/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { coerceQuery, dispatchEditorial as d, outboxQueue } from '../_lib/editorial';

let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let admin: Awaited<ReturnType<typeof app.actor>>;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let revisor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;

const S = (p: string) => `/api/studio/editorial${p}`;
const PUBLIC = '/api/editorial/right-of-reply';

beforeAll(async () => {
  app = await makeApp();
  store = new PgEditorialStore(app.db);
  [admin, chefe, editor, revisor, leitor, comercial] = [
    await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'),
    await app.actor('revisor'), await app.actor('leitor'), await app.actor('comercial'),
  ];
  await store.putArticle(sampleArticle('art-1', { status: 'em_checagem', updatedAt: '2026-11-23T12:00:00.000Z' }));
  await store.putArticle(sampleArticle('art-2', { status: 'bloqueado', blockers: ['no_evidence' as never], updatedAt: '2026-11-23T13:00:00.000Z' }));
  await store.putArticle(sampleArticle('art-3', { status: 'em_checagem', updatedAt: '2026-11-23T14:00:00.000Z' }));
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('sessão, MFA e RBAC', () => {
  it('sem sessão 401; só senha 403 MFA_REQUIRED; comercial barrado na borda; leitor barrado pelo handler', async () => {
    expect((await call(d, 'GET', { path: S('/queue') })).status).toBe(401);
    const solo = await app.passwordOnly('editor_chefe');
    expect((await call(d, 'GET', { path: S('/queue'), as: solo })).body.error.code).toBe('MFA_REQUIRED');
    expect((await call(d, 'GET', { path: S('/queue'), as: comercial })).status).toBe(403);
    const l = await call(d, 'GET', { path: S('/queue'), as: leitor });
    expect(l.status).toBe(403);
    expect(l.body.error.code).toBe('FORBIDDEN');
    expect((await call(d, 'GET', { path: S('/queue'), as: editor })).status).toBe(200);
  });
  it('rota inexistente 404 e método errado 405', async () => {
    expect((await call(d, 'GET', { path: S('/nada'), as: chefe })).status).toBe(404);
    expect((await call(d, 'GET', { path: S('/articles/art-1/recheck'), as: chefe })).status).toBe(405);
  });
});

describe('fila e revisão', () => {
  it('fila: query string vira número, bloqueadas primeiro, filtros e paginação', async () => {
    const all = await call(d, 'GET', { path: S('/queue'), as: editor });
    expect(all.body.total).toBe(3);
    expect(all.body.items[0].articleId).toBe('art-2'); // bloqueada primeiro
    const page = await call(d, 'GET', { path: S('/queue'), query: { limit: '1', offset: '1' }, as: editor });
    expect(page.body).toMatchObject({ limit: 1, offset: 1, total: 3 });
    expect(page.body.items).toHaveLength(1);
    expect((await call(d, 'GET', { path: S('/queue'), query: { status: 'bloqueado' }, as: editor })).body.items).toHaveLength(1);
    expect((await call(d, 'GET', { path: S('/queue'), query: { status: 'inventado' }, as: editor })).status).toBe(400);
    expect(coerceQuery({ limit: '5', x: '7', somenteElegiveis: 'true' })).toEqual({ limit: 5, x: '7', somenteElegiveis: true });
  });

  it('visão de revisão recalcula o gate; revisão exige papel: editor 403, revisor devolve à redação (persistido e auditado)', async () => {
    const v = await call(d, 'GET', { path: S('/articles/art-1/review'), as: editor });
    expect(v.status).toBe(200);
    expect(v.body.gate).toHaveProperty('passou');
    expect((await call(d, 'GET', { path: S('/articles/nao-existe/review'), as: editor })).status).toBe(404);
    const body = { decision: 'send_back', note: 'Fonte não sustenta o número citado.' };
    expect((await call(d, 'POST', { path: S('/articles/art-1/review'), body, as: editor })).status).toBe(403);
    expect((await call(d, 'POST', { path: S('/articles/art-1/review'), body: { decision: 'send_back', note: 'x' }, as: revisor })).status).toBe(400);
    const r = await call(d, 'POST', { path: S('/articles/art-1/review'), body, as: revisor });
    expect(r.body).toMatchObject({ articleId: 'art-1', status: 'rascunho' });
    expect((await store.getArticle('art-1'))?.reviews.at(-1)).toMatchObject({ userId: revisor.id, decision: 'send_back' });
    expect((await store.listAudit()).some((a) => a.action === 'review.send_back' && a.userId === revisor.id)).toBe(true);
    // confirmar sem aprovação não passa (humano não força o gate)
    expect((await call(d, 'POST', { path: S('/articles/art-3/review'), body: { decision: 'confirm', note: 'ok confirmo' }, as: chefe })).status).toBe(409);
  });

  it('dois revisores ao mesmo tempo: o lock serializa e só um vence', async () => {
    const body = { decision: 'send_back', note: 'Devolvida por dois revisores ao mesmo tempo.' };
    const rs = await Promise.all([
      call(d, 'POST', { path: S('/articles/art-3/review'), body, as: revisor }),
      call(d, 'POST', { path: S('/articles/art-3/review'), body, as: chefe }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await store.getArticle('art-3'))?.reviews).toHaveLength(1);
  });

  it('recheck: enfileira no outbox só com ids (idempotência sem ":"), incrementa a contagem e responde 202; editor 403', async () => {
    await store.putArticle(sampleArticle('art-4', { status: 'em_checagem' }));
    expect((await call(d, 'POST', { path: S('/articles/art-4/recheck'), as: editor })).status).toBe(403);
    const r = await call(d, 'POST', { path: S('/articles/art-4/recheck'), as: revisor });
    expect(r.status).toBe(202);
    expect(r.body.jobId).toBe('art-4:factcheck:r1');
    const rows = await app.db.select().from(schema.outbox).where(eq(schema.outbox.refId, 'art-4'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ queue: 'checagem', idempotencyKey: 'art-4_factcheck_r1', status: 'pending' });
    expect((await store.getArticle('art-4'))?.recheckCount).toBe(1);
    await call(d, 'POST', { path: S('/articles/art-4/recheck'), as: revisor });
    expect(await app.db.$count(schema.outbox, eq(schema.outbox.refId, 'art-4'))).toBe(2);
    await expect(outboxQueue(app.db).enqueue({ stage: 'inventada' as never, jobId: 'x', data: { articleId: 'a' } as never })).rejects.toThrow(/sem fila/);
  });
});

describe('direito de resposta e correções', () => {
  beforeAll(async () => {
    // ADR-019 §c: o caso ancora em articles.id JÁ PUBLICADO (aqui, uma matéria da Fábrica: há registro editorial com o mesmo id)
    await app.db.insert(schema.articles).values({
      id: 'art-4', slug: 'materia-art-4', titulo: 'Matéria publicada', editoria: 'pontos', corpo: 'Corpo.', resumo: 'Resumo.', status: 'publicado', publicadoEm: new Date('2026-11-20T10:00:00Z'),
    });
  });

  const intake = (over: Record<string, unknown> = {}) => ({
    articleId: 'art-4', contested: 'trecho contestado da matéria', requester: { name: 'Fulana de Tal' },
    contact: 'fulana@exemplo.test', replyText: 'Texto da resposta com mais de dez caracteres.', ...over,
  });

  it('formulário público: cria caso (identidade não verificada), não devolve contato; entrada inválida 400; matéria inexistente 404', async () => {
    const r = await call(d, 'POST', { path: PUBLIC, body: intake() });
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(['correctionId', 'state']);
    expect(JSON.stringify(r.body)).not.toContain('fulana@');
    expect((await call(d, 'POST', { path: PUBLIC, body: intake({ replyText: 'curta' }) })).status).toBe(400);
    expect((await call(d, 'POST', { path: PUBLIC, body: intake({ articleId: 'nao-existe' }) })).status).toBe(404);
    const stored = await store.getCorrection(r.body.correctionId);
    expect(stored?.case.requester.identityVerified).toBe(false);
    expect(stored?.contact).toBe('fulana@exemplo.test'); // guardado para o caso
    expect((await store.listAudit()).some((a) => a.action === 'correction.open' && a.userId === null)).toBe(true);
  });

  it('Studio: lista e detalhe sem expor o contato; verificar identidade só editor-chefe/admin; ciência jurídica só admin', async () => {
    const list = await call(d, 'GET', { path: S('/corrections'), as: editor });
    expect(list.status).toBe(200);
    const id = list.body.items[0].id as string;
    expect(JSON.stringify(list.body)).not.toContain('fulana@');
    const one = await call(d, 'GET', { path: S(`/corrections/${id}`), as: revisor });
    expect(one.status).toBe(200);
    expect(JSON.stringify(one.body)).not.toContain('fulana@');
    const v = { method: 'Documento conferido por telefone com o requerente.' };
    expect((await call(d, 'POST', { path: S(`/corrections/${id}/verify-requester`), body: v, as: editor })).status).toBe(403);
    expect((await call(d, 'POST', { path: S(`/corrections/${id}/verify-requester`), body: v, as: chefe })).status).toBe(200);
    expect((await call(d, 'POST', { path: S(`/corrections/${id}/ack-legal`), as: chefe })).status).toBe(403);
    expect((await call(d, 'POST', { path: S(`/corrections/${id}/ack-legal`), as: admin })).status).not.toBe(403);
    expect((await call(d, 'GET', { path: S('/corrections/nao-existe'), as: editor })).status).toBe(404);
    // abrir caso manualmente: papel de gestão
    const open = { articleId: 'art-4', kind: 'erratum', contested: 'dado errado', requester: { name: 'Redação', channel: 'interno' } };
    expect((await call(d, 'POST', { path: S('/corrections'), body: open, as: editor })).status).toBe(403);
  });

  it('limite do formulário público por IP (com proxy confiável): 5 por 15 min', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    try {
      const statuses = [];
      for (let i = 0; i < 7; i++) statuses.push((await call(d, 'POST', { path: PUBLIC, body: intake() })).status);
      expect(statuses.filter((s) => s === 201).length).toBe(5);
      expect(statuses.filter((s) => s === 429).length).toBe(2);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });
});

describe('fontes: revisão e habilitação', () => {
  const REVIEW = { termsStatus: 'approved', termsNote: 'Termos oficiais lidos na página do BC; reuso editorial por citação e link.', urlVerified: true, robotsChecked: true, paywall: 'none' };

  it('cadastro nasce desabilitado; filtros booleanos da query; revisor revisa mas não habilita; desabilitar é permitido a quem revisa', async () => {
    const l = await call(d, 'GET', { path: S('/sources'), query: { somenteElegiveis: 'true' }, as: editor });
    expect(l.body.items).toHaveLength(0);
    const all = await call(d, 'GET', { path: S('/sources'), as: editor });
    expect(all.body.items.length).toBeGreaterThanOrEqual(30);
    expect(all.body.items.every((s: any) => !s.habilitada)).toBe(true);
    expect((await call(d, 'POST', { path: S('/sources/bcb/review'), body: { ...REVIEW, termsNote: 'ok' }, as: revisor })).status).toBe(400);
    expect((await call(d, 'POST', { path: S('/sources/bcb/review'), body: REVIEW, as: editor })).status).toBe(403);
    const rv = await call(d, 'POST', { path: S('/sources/bcb/review'), body: REVIEW, as: revisor });
    expect(rv.status).toBe(200);
    expect(rv.body.revisao).toMatchObject({ revisor: revisor.id, termos: 'approved' });
    expect((await call(d, 'POST', { path: S('/sources/bcb/enabled'), body: { enabled: true }, as: revisor })).status).toBe(403);
    expect((await call(d, 'POST', { path: S('/sources/bcb/enabled'), body: { enabled: false }, as: revisor })).status).toBe(200);
    expect((await call(d, 'POST', { path: S('/sources/nao-existe/review'), body: REVIEW, as: revisor })).status).toBe(404);
    expect((await store.getSourceState('bcb'))?.review?.reviewer).toBe(revisor.id);
  });

  it('habilitar: editor-chefe habilita após a revisão atual de outra pessoa; novo review desliga a fonte', async () => {
    const en = await call(d, 'POST', { path: S('/sources/bcb/enabled'), body: { enabled: true }, as: chefe });
    expect(en.status).toBe(200);
    expect(en.body.habilitada).toBe(true);
    await call(d, 'POST', { path: S('/sources/bcb/review'), body: REVIEW, as: revisor });
    expect((await store.getSourceState('bcb'))?.enabled).toBe(false);
  });
});
