/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import type { ArticleRecord } from '@ln/editorial';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { dispatchEditorial as d } from '../_lib/editorial';
import * as recibos from '../materias/[id]/recibos/route';

// GET /api/studio/editorial/articles/{id}/draft: rascunho completo + última checagem para o formulário de correção.
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
const roles: Record<string, Awaited<ReturnType<typeof app.actor>>> = {};
let n = 0;

const S = (p: string) => `/api/studio/editorial${p}`;
const draftOf = (id: string, as: any = chefe) => call(d, 'GET', { path: S(`/articles/${id}/draft`), as });
const SEGREDO = 'SEGREDO-NO-TEXTO-DA-EVIDENCIA';
const CHECK = [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }];

function approved(id: string): ArticleRecord {
  const a = sampleArticle(id, { status: 'aprovado' });
  a.evidences = a.evidences.map((e) => ({ ...e, text: `Texto MOCK. Nas palavras de Pessoa MOCK: texto literal. ${SEGREDO}` }));
  a.factcheck = { provider: 'anthropic', model: 'mock', verdicts: a.draft!.claims.map((c) => ({ claimId: c.id, verdict: 'pass' as const })) };
  // lixo interno que NUNCA pode sair (campos fora do contrato que alguém gravou no registro)
  (a.draft as any).promptBruto = 'PROMPT-BRUTO-INTERNO';
  (a.draft as any).apiKey = 'sk-nao-vazar';
  (a as any).segredoInterno = 'SEGREDO-INTERNO';
  return a;
}
async function publicada() {
  const id = `dv-${++n}`;
  await store.putArticle(approved(id));
  const r = await call(recibos.POST, 'POST', { params: { id }, body: { checagens: CHECK }, as: chefe });
  expect(r.status).toBe(201);
  const p = await call(d, 'POST', { path: S(`/articles/${id}/publication`), body: { receiptId: r.body.data.id, url: `https://loyaltynews.example/noticia/${id}` }, as: chefe });
  expect(p.status).toBe(201);
  return id;
}

beforeAll(async () => {
  app = await makeApp({ publicacaoPortal: true });
  store = new PgEditorialStore(app.db);
  chefe = await app.actor('editor_chefe');
  for (const r of ['admin', 'editor', 'revisor', 'leitor', 'comercial'] as const) roles[r] = await app.actor(r);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('acesso', () => {
  it('sem sessão 401; só senha MFA_REQUIRED; comercial barrado na borda; leitor 403; redação (admin, chefe, editor, revisor) lê', async () => {
    const id = await publicada();
    expect((await call(d, 'GET', { path: S(`/articles/${id}/draft`) })).status).toBe(401);
    const solo = await app.passwordOnly('editor_chefe');
    expect((await draftOf(id, solo)).body.error.code).toBe('MFA_REQUIRED');
    expect((await draftOf(id, roles.comercial)).status).toBe(403);
    const l = await draftOf(id, roles.leitor);
    expect(l.status).toBe(403);
    expect(l.body.error.code).toBe('FORBIDDEN');
    for (const as of [chefe, roles.admin, roles.editor, roles.revisor]) expect((await draftOf(id, as)).status).toBe(200);
  });

  it('inexistente e matéria sem registro editorial (só do CMS): 404; id fora do padrão: 400; método de escrita não existe (405)', async () => {
    expect((await draftOf('nao-existe')).status).toBe(404);
    await app.db.insert(schema.articles).values({ id: 'so-cms-dv', slug: 'so-cms-dv', titulo: 'T', editoria: 'pontos', corpo: 'C', resumo: 'R', status: 'publicado', publicadoEm: new Date() });
    expect((await draftOf('so-cms-dv')).status).toBe(404);
    expect((await draftOf('a b')).status).toBe(400);
    expect((await call(d, 'POST', { path: S('/articles/dv-1/draft'), body: {}, as: chefe })).status).toBe(405);
  });
});

describe('conteúdo', () => {
  it('traz o que applyCorrection precisa: id do rascunho, classe de dado, provedor e versão do prompt, claims, imagem e a última checagem', async () => {
    const id = await publicada();
    const r = await draftOf(id);
    const rec = (await store.getArticle(id))!;
    expect(r.body).toMatchObject({ articleId: id, status: 'publicado', versaoPublicada: 1, podeCorrigir: true, avisos: [] });
    expect(r.body.publicacao).toMatchObject({ url: `https://loyaltynews.example/noticia/${id}`, corrigidoEm: null });
    expect(r.body.rascunho).toMatchObject({
      id: rec.draft!.id, editoria: 'pontos', slug: rec.draft!.slug, headline: rec.draft!.headline, resumo: rec.draft!.resumo, tipoConteudo: 'noticia',
      classeDeDado: 'public', patrocinado: false, signature: rec.draft!.signature, modelProvider: 'deepseek', promptVersion: 'editorial-0.1',
      evidenceIds: ['ev_1'], image: { mode: 'none' },
    });
    expect(r.body.rascunho.claims).toHaveLength(2);
    expect(r.body.rascunho.claims[1]).toMatchObject({ id: 'c2', kind: 'quote', quote: { text: 'texto literal', speaker: 'Pessoa MOCK' } });
    expect(r.body.checagem).toEqual({ provider: 'anthropic', model: 'mock', verdicts: [{ claimId: 'c1', verdict: 'pass' }, { claimId: 'c2', verdict: 'pass' }] });
    expect(r.body.rascunho.subtitulo).toBeUndefined(); // ausente é omitido, não null
  });

  it('NÃO vaza: texto das evidências, campos fora do contrato (prompt bruto, chaves), registro interno; só as chaves esperadas', async () => {
    const id = await publicada();
    const r = await draftOf(id);
    const txt = JSON.stringify(r.body);
    for (const proibido of [SEGREDO, 'PROMPT-BRUTO-INTERNO', 'sk-nao-vazar', 'SEGREDO-INTERNO', 'promptBruto', 'apiKey']) expect(txt).not.toContain(proibido);
    expect(Object.keys(r.body).sort()).toEqual(['articleId', 'avisos', 'checagem', 'podeCorrigir', 'publicacao', 'rascunho', 'status', 'versaoPublicada']);
    expect(Object.keys(r.body.rascunho).sort()).toEqual(
      ['body', 'claims', 'classeDeDado', 'editoria', 'evidenceIds', 'headline', 'id', 'image', 'modelProvider', 'patrocinado', 'promptVersion', 'resumo', 'signature', 'slug', 'tipoConteudo'].sort(),
    );
    expect(r.body).not.toHaveProperty('evidencias');
    expect(r.body).not.toHaveProperty('evidences');
  });

  it('o JSON devolvido é aceito como está no formulário de correção (recibo e publicação); depois o corpo vem SEM Avisos e os avisos listados', async () => {
    const id = await publicada();
    const o = await call(d, 'POST', { path: S('/corrections'), body: { articleId: id, kind: 'erratum', contested: 'afirmação MOCK', requester: { name: 'Redação', channel: 'internal' } }, as: chefe });
    const caso = (o.body.id ?? o.body.correctionId) as string;
    await call(d, 'POST', { path: S(`/corrections/${caso}/preserve-evidence`), body: { url: 'https://loyaltynews.example/noticia/x', body: 'pagina' }, as: chefe });
    const t = await call(d, 'POST', {
      path: S(`/corrections/${caso}/triage`),
      body: { accepted: true, reason: 'Procede.', corrected: 'afirmação corrigida', claims: [{ id: 'c1', text: 'afirmação corrigida', kind: 'fact', evidenceIds: ['ev_1'] }] },
      as: chefe,
    });
    expect(t.status).toBe(200);

    const lido = (await draftOf(id)).body;
    const correcao = { casoId: caso, draft: { ...lido.rascunho, body: lido.rascunho.body.replace('Corpo MOCK.', 'Corpo MOCK corrigido.') }, factcheck: lido.checagem };
    const rc = await call(recibos.POST, 'POST', { params: { id }, body: { checagens: CHECK, correcao }, as: chefe });
    expect(rc.status, JSON.stringify(rc.body)).toBe(201);
    const p = await call(d, 'POST', { path: S(`/articles/${id}/publication`), body: { receiptId: rc.body.data.id, url: `https://loyaltynews.example/noticia/${id}`, correcao }, as: chefe });
    expect(p.status, JSON.stringify(p.body)).toBe(201);

    const depois = (await draftOf(id)).body;
    expect(depois).toMatchObject({ status: 'corrigido', versaoPublicada: 2 });
    expect(depois.avisos).toHaveLength(1);
    expect(depois.avisos[0]).toMatchObject({ caseId: caso, tipo: 'erratum' });
    expect(depois.rascunho.body).not.toContain('Avisos:');
    expect(depois.rascunho.body).toContain('Corpo MOCK corrigido.');
    expect(depois.rascunho.body).toContain('Fontes:');
    expect(depois.publicacao.corrigidoEm).not.toBeNull();
  });
});
