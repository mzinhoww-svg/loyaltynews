/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp, seedEvidence } from '../_lib/testkit';
import { dispatchEditorial as d } from '../_lib/editorial';
import * as materias from './route';
import * as materia from './[id]/route';
import * as transicao from './[id]/transicao/route';
import * as recibos from './[id]/recibos/route';
import * as correcao from './[id]/correcao/route';
import * as pubOne from '../publico/materias/[slug]/route';

// ADR-019 §c.5 + publicação oficial de matéria só do CMS: nova versão, recibo e publicação `corrigido` pela rota oficial.
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
let ev: string[];
let n = 0;

const S = (p: string) => `/api/studio/editorial${p}`;
const P = (id: string) => S(`/articles/${id}/publication`);
const URL_PUB = 'https://loyaltynews.example/noticia/x';

async function create(over: Record<string, unknown> = {}) {
  const r = await call(materias.POST, 'POST', {
    body: { slug: `cms-${++n}`, titulo: 'Programa muda regra de pontos', editoria: 'pontos', resumo: 'Resumo curto da matéria.', corpo: 'O prazo de validade é de 12 meses.', evidenceIds: [ev[0]], ...over },
    as: editor,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; slug: string; versao: number };
}
const go = (id: string, para: string, as = chefe) => call(transicao.POST, 'POST', { params: { id }, body: { para }, as });
const receipt = (id: string, versao: number, as = chefe, extra: Record<string, unknown> = {}) =>
  call(recibos.POST, 'POST', { params: { id }, body: { versao, checagens: [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }], ...extra }, as });
const publish = (id: string, receiptId: string, as = chefe) => call(d, 'POST', { path: P(id), body: { receiptId, url: URL_PUB }, as });
const row = async (id: string) => (await app.db.select().from(schema.articles).where(eq(schema.articles.id, id)))[0]!;
const outboxOf = async (id: string) => (await app.db.select().from(schema.outbox).where(eq(schema.outbox.refId, id))).map((o) => o.idempotencyKey).sort();
const transitions = async (id: string) => app.db.select().from(schema.articleTransitions).where(eq(schema.articleTransitions.articleId, id));

/** CMS-only: rascunho → em_checagem → recibo → aprovado → PUBLICADO pela rota oficial. */
async function published(over: Record<string, unknown> = {}) {
  const a = await create(over);
  expect((await go(a.id, 'em_checagem')).status).toBe(200);
  const r = await receipt(a.id, a.versao);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect((await go(a.id, 'aprovado')).status).toBe(200);
  const p = await publish(a.id, r.body.data.id);
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  return { ...a, receiptId: r.body.data.id as string, sha: r.body.data.conteudoSha256 as string };
}

/** Caso de errata ACEITO pelo caminho real do Editorial (abrir → preservar → triar com claim sustentada por evidência da matéria). */
async function acceptedCase(articleId: string, over: { kind?: string; corrected?: string } = {}) {
  const o = await call(d, 'POST', { path: S('/corrections'), body: { articleId, kind: over.kind ?? 'erratum', contested: 'prazo de 12 meses', requester: { name: 'Redação', channel: 'internal' } }, as: chefe });
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  const id = (o.body.id ?? o.body.correctionId) as string;
  expect((await call(d, 'POST', { path: S(`/corrections/${id}/preserve-evidence`), body: { url: 'https://loyaltynews.example/noticia/x', body: 'pagina' }, as: chefe })).status).toBe(200);
  const t = await call(d, 'POST', {
    path: S(`/corrections/${id}/triage`),
    body: { accepted: true, reason: 'Procede.', corrected: over.corrected ?? 'prazo de 24 meses', claims: [{ id: 'k1', text: 'o prazo é de 24 meses', kind: 'fact', evidenceIds: [ev[0]] }] },
    as: chefe,
  });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  return id;
}
const revise = (id: string, versaoEsperada: number, body: Record<string, unknown>, as = chefe) =>
  call(materia.PATCH, 'PATCH', { params: { id }, body: { versaoEsperada, ...body }, as });

beforeAll(async () => {
  app = await makeApp({ publicacaoPortal: true });
  store = new PgEditorialStore(app.db);
  [chefe, admin, editor, leitor] = [await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('editor'), await app.actor('leitor')];
  ev = await seedEvidence(app.db, 2);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('publicação oficial de matéria só do CMS (sem registro editorial)', () => {
  it('aprovada com recibo ⇒ 201: publicado, histórico com o recibo, outbox article.published:{id}:{sha}; repetir ⇒ 200 sem novos efeitos; o público passa a ver', async () => {
    const a = await create();
    await go(a.id, 'em_checagem');
    const r = await receipt(a.id, a.versao);
    await go(a.id, 'aprovado');
    expect((await call(pubOne.GET, 'GET', { params: { slug: a.slug } })).status).toBe(404);
    const p = await publish(a.id, r.body.data.id);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body).toMatchObject({ articleId: a.id, status: 'publicado', outbox: 'enqueued', alreadyPublished: false });
    expect(p.body.publication.contentSha256).toBe(r.body.data.conteudoSha256);
    expect(await row(a.id)).toMatchObject({ status: 'publicado', versao: 1 });
    expect((await row(a.id)).publicadoEm?.toISOString()).toBe('2026-11-22T12:00:00.000Z');
    expect(await outboxOf(a.id)).toEqual([`article.published:${a.id}:${r.body.data.conteudoSha256}`]);
    expect((await transitions(a.id)).filter((t) => t.para === 'publicado')).toMatchObject([{ de: 'aprovado', actorId: chefe.id, receiptId: r.body.data.id }]);
    const again = await publish(a.id, r.body.data.id);
    expect(again.status).toBe(200);
    expect(again.body.alreadyPublished).toBe(true);
    expect(await outboxOf(a.id)).toHaveLength(1);
    expect((await transitions(a.id)).filter((t) => t.para === 'publicado')).toHaveLength(1);
    expect((await call(pubOne.GET, 'GET', { params: { slug: a.slug } })).status).toBe(200);
    // a rota genérica continua sem publicar nem corrigir
    expect((await go(a.id, 'corrigido')).status).toBe(409);
  });

  it('portões: flag desligada 403; identidade de publicação diferente 403; recibo de outra matéria 409; conteúdo alterado depois do recibo 409; sem papel de publicar 403 — sem efeito', async () => {
    const a = await create();
    await go(a.id, 'em_checagem');
    const r = await receipt(a.id, a.versao, chefe, { identidadePublicacao: admin.id });
    await go(a.id, 'aprovado');
    const semEfeito = async () => {
      expect((await row(a.id)).status).toBe('aprovado');
      expect(await outboxOf(a.id)).toEqual([]);
      expect((await transitions(a.id)).filter((t) => t.para === 'publicado')).toHaveLength(0);
    };
    app.deps.flags.publicacaoPortal = false;
    try {
      expect((await publish(a.id, r.body.data.id, admin)).body.error.code).toBe('FEATURE_DISABLED');
    } finally {
      app.deps.flags.publicacaoPortal = true;
    }
    expect((await publish(a.id, r.body.data.id, chefe)).body.error.code).toBe('NOT_PUBLISHER_IDENTITY');
    expect((await publish(a.id, r.body.data.id, editor)).status).toBe(403);
    expect((await publish(a.id, 'recibo-que-nao-existe', admin)).status).toBe(409);
    await app.db.update(schema.articles).set({ corpo: 'texto trocado por fora do fluxo' }).where(eq(schema.articles.id, a.id));
    const adult = await publish(a.id, r.body.data.id, admin);
    expect(adult.status).toBe(409);
    expect(adult.body.error.code).toBe('RECEIPT_CONTENT_MISMATCH');
    await semEfeito();
  });

  it('regras refeitas na publicação: matéria que deixou de passar (classe de dado) não publica', async () => {
    const a = await create();
    await go(a.id, 'em_checagem');
    const r = await receipt(a.id, a.versao);
    await go(a.id, 'aprovado');
    await app.db.update(schema.articles).set({ classeDeDado: 'personal' }).where(eq(schema.articles.id, a.id));
    const p = await publish(a.id, r.body.data.id);
    expect(p.status).toBe(409);
    expect(['GATE_FAILED', 'RECEIPT_CONTENT_MISMATCH']).toContain(p.body.error.code);
    expect((await row(a.id)).status).toBe('aprovado');
  });
});

describe('correção de matéria do CMS publicada: revisão → recibo → publicação oficial `corrigido`', () => {
  it('portões da revisão: sem caso, caso inexistente, caso de outra matéria, caso não aceito, campos não corrigíveis, versão defasada, matéria da Fábrica', async () => {
    const a = await published();
    const outra = await published();
    const casoOutra = await acceptedCase(outra.id);
    const aberto = await call(d, 'POST', { path: S('/corrections'), body: { articleId: a.id, kind: 'erratum', contested: 'prazo de 12 meses', requester: { name: 'Redação', channel: 'internal' } }, as: chefe });
    const casoAberto = (aberto.body.id ?? aberto.body.correctionId) as string;

    expect((await revise(a.id, 1, { corpo: 'novo' })).body.error.code).toBe('CORRECTION_CASE_REQUIRED');
    expect((await revise(a.id, 1, { corpo: 'novo', casoCorrecaoId: 'nao-existe' })).status).toBe(404);
    expect((await revise(a.id, 1, { corpo: 'novo', casoCorrecaoId: casoOutra })).body.error.code).toBe('CASE_MISMATCH');
    expect((await revise(a.id, 1, { corpo: 'novo', casoCorrecaoId: casoAberto })).body.error.code).toBe('CASE_NOT_ACCEPTED');
    const caso = await acceptedCase(a.id);
    for (const campo of [{ editoria: 'mercado' }, { tipoConteudo: 'analise' }, { classeDeDado: 'internal' }, { patrocinado: true }, { rotuloPublieditorial: 'x' }]) {
      const r = await revise(a.id, 1, { ...campo, casoCorrecaoId: caso });
      expect(r.status, JSON.stringify(campo)).toBe(422);
      expect(r.body.error.code).toBe('FIELD_NOT_CORRECTABLE');
    }
    expect((await revise(a.id, 7, { corpo: 'novo', casoCorrecaoId: caso })).body.error.code).toBe('VERSION_MISMATCH');
    expect((await revise(a.id, 1, { corpo: 'novo', casoCorrecaoId: caso }, editor)).status).toBe(200); // editor tem materias:update
    // a matéria e a página seguem intactas
    expect(await row(a.id)).toMatchObject({ status: 'publicado', versao: 1, corpo: 'O prazo de validade é de 12 meses.' });
    // matéria da Fábrica (com registro editorial) não usa este caminho
    const fab = await published();
    await store.putArticle(sampleArticle(fab.id, { status: 'publicado' }));
    const casoFab = await acceptedCase(fab.id);
    expect((await revise(fab.id, 1, { corpo: 'novo', casoCorrecaoId: casoFab })).body.error.code).toBe('EDITORIAL_ORIGIN');
    // casoCorrecaoId em matéria não publicada é recusado
    const rasc = await create();
    expect((await revise(rasc.id, rasc.versao, { corpo: 'novo', casoCorrecaoId: caso })).status).toBe(422);
  });

  it('fluxo completo: a página não muda até a publicação; recibo prova corpo+aviso; publicação ⇒ corrigido, nova versão, aviso no corpo, outbox article.corrected, erratas públicas; repetição idempotente', async () => {
    const a = await published();
    const caso = await acceptedCase(a.id);
    const rev = await revise(a.id, 1, { corpo: 'O prazo de validade é de 24 meses.', casoCorrecaoId: caso });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    const aviso = rev.body.data.aviso as string;
    expect(aviso).toContain('prazo de 24 meses');
    expect(rev.body.data).toMatchObject({ estado: 'rascunho', baseVersao: 1, versao: 2, casoId: caso, corpoFinal: `O prazo de validade é de 24 meses.\n\n${aviso}` });

    // a página pública ainda mostra a versão publicada
    const antes = await call(pubOne.GET, 'GET', { params: { slug: a.slug } });
    expect(antes.body.data.corpo).toBe('O prazo de validade é de 12 meses.');
    expect(antes.body.data.erratas).toEqual([]);

    // recibo da revisão: versão errada recusada; certa emite; repetir é idempotente
    expect((await receipt(a.id, 1)).body.error.code).toBe('VERSION_MISMATCH');
    const r = await receipt(a.id, 2);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.versao).toBe(2);
    expect(r.body.data.conteudoSha256).not.toBe(a.sha);
    expect((await receipt(a.id, 2)).status).toBe(200);
    // revisão aprovada não se edita; é preciso descartar
    expect((await revise(a.id, 1, { corpo: 'outro', casoCorrecaoId: caso })).body.error.code).toBe('REVISION_APPROVED');

    // publicação oficial
    const p = await publish(a.id, r.body.data.id);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body).toMatchObject({ status: 'corrigido', outbox: 'enqueued', alreadyPublished: false });
    const depois = await row(a.id);
    expect(depois).toMatchObject({ status: 'corrigido', versao: 2, corpo: `O prazo de validade é de 24 meses.\n\n${aviso}` });
    expect(depois.publicadoEm?.toISOString()).toBe('2026-11-22T12:00:00.000Z'); // a data original da publicação não muda
    expect(await outboxOf(a.id)).toEqual([`article.corrected:${a.id}:${r.body.data.conteudoSha256}`, `article.published:${a.id}:${a.sha}`].sort());
    const corr = (await transitions(a.id)).filter((t) => t.para === 'corrigido');
    expect(corr).toMatchObject([{ de: 'publicado', nota: aviso, receiptId: r.body.data.id, actorId: chefe.id }]);
    const pub = await call(pubOne.GET, 'GET', { params: { slug: a.slug } });
    expect(pub.body.data.corpo).toContain('24 meses');
    expect(pub.body.data.corpo.endsWith(aviso)).toBe(true);
    expect(pub.body.data.erratas.map((e: any) => e.nota)).toEqual([aviso]);
    expect((await app.db.select().from(schema.articleRevisions).where(eq(schema.articleRevisions.articleId, a.id)))[0]).toMatchObject({ estado: 'publicada' });

    // repetir o mesmo recibo: 200, nada novo
    const again = await publish(a.id, r.body.data.id);
    expect(again.status).toBe(200);
    expect(again.body.alreadyPublished).toBe(true);
    expect((await transitions(a.id)).filter((t) => t.para === 'corrigido')).toHaveLength(1);
    expect(await outboxOf(a.id)).toHaveLength(2);
    // o recibo da versão ANTIGA não republica nada
    expect((await publish(a.id, a.receiptId)).status).toBeGreaterThanOrEqual(409);
    expect((await row(a.id)).versao).toBe(2);
  });

  it('segunda correção: o aviso anterior não pode sair do corpo; com ele preservado publica de novo (versão 3, dois avisos)', async () => {
    const a = await published();
    const caso1 = await acceptedCase(a.id);
    const r1 = await revise(a.id, 1, { corpo: 'O prazo de validade é de 24 meses.', casoCorrecaoId: caso1 });
    const rc1 = await receipt(a.id, 2);
    expect((await publish(a.id, rc1.body.data.id)).status).toBe(201);
    const aviso1 = r1.body.data.aviso as string;
    const atual = (await row(a.id)).corpo;

    const caso2 = await acceptedCase(a.id, { corrected: 'prazo de 24 meses, contados da emissão' });
    const semAviso = await revise(a.id, 2, { corpo: 'O prazo de validade é de 24 meses (reescrito).', casoCorrecaoId: caso2 });
    expect(semAviso.status).toBe(422);
    expect(semAviso.body.error.code).toBe('PRIOR_NOTICE_REMOVED');
    const ok = await revise(a.id, 2, { corpo: atual.replace('24 meses.', '24 meses, contados da emissão.'), casoCorrecaoId: caso2 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ baseVersao: 2, versao: 3 });
    const rc2 = await receipt(a.id, 3);
    expect((await publish(a.id, rc2.body.data.id)).status).toBe(201);
    const fim = await row(a.id);
    expect(fim).toMatchObject({ status: 'corrigido', versao: 3 });
    expect(fim.corpo).toContain(aviso1);
    expect(fim.corpo.endsWith(ok.body.data.aviso)).toBe(true);
    expect((await call(pubOne.GET, 'GET', { params: { slug: a.slug } })).body.data.erratas).toHaveLength(2);
  });

  it('descartar a revisão não toca a página; a nova revisão usa uma versão que nunca teve recibo', async () => {
    const a = await published();
    const caso = await acceptedCase(a.id);
    await revise(a.id, 1, { corpo: 'Primeira tentativa.', casoCorrecaoId: caso });
    const rc = await receipt(a.id, 2);
    expect(rc.status).toBe(201);
    expect((await call(correcao.DELETE, 'DELETE', { params: { id: a.id }, as: leitor })).status).toBe(403);
    expect((await call(correcao.GET, 'GET', { params: { id: a.id } })).status).toBe(401);
    expect((await call(correcao.DELETE, 'DELETE', { params: { id: a.id }, as: chefe })).body.data.estado).toBe('descartada');
    expect((await call(correcao.GET, 'GET', { params: { id: a.id }, as: chefe })).status).toBe(404);
    expect(await row(a.id)).toMatchObject({ status: 'publicado', versao: 1, corpo: 'O prazo de validade é de 12 meses.' });
    // o recibo da revisão descartada não publica nada
    const p = await publish(a.id, rc.body.data.id);
    expect(p.status).toBe(409);
    expect((await row(a.id)).status).toBe('publicado');
    const nova = await revise(a.id, 1, { corpo: 'Segunda tentativa.', casoCorrecaoId: caso });
    expect(nova.body.data.versao).toBe(3); // a 2 já teve recibo
    expect((await receipt(a.id, 3)).status).toBe(201);
  });

  it('segurança: revisão adulterada depois do recibo (hash diferente) e matéria que mudou depois da revisão não publicam; nada muda', async () => {
    const a = await published();
    const caso = await acceptedCase(a.id);
    await revise(a.id, 1, { corpo: 'Texto corrigido.', casoCorrecaoId: caso });
    const rc = await receipt(a.id, 2);
    await app.db.update(schema.articleRevisions).set({ corpo: 'Texto trocado por fora do fluxo.' }).where(eq(schema.articleRevisions.articleId, a.id));
    const bad = await publish(a.id, rc.body.data.id);
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('RECEIPT_CONTENT_MISMATCH');
    expect(await row(a.id)).toMatchObject({ status: 'publicado', versao: 1 });
    expect(await outboxOf(a.id)).toEqual([`article.published:${a.id}:${a.sha}`]);

    const b = await published();
    const casoB = await acceptedCase(b.id);
    await revise(b.id, 1, { corpo: 'Texto corrigido B.', casoCorrecaoId: casoB });
    const rcB = await receipt(b.id, 2);
    await app.db.update(schema.articles).set({ versao: 5 }).where(eq(schema.articles.id, b.id));
    expect((await publish(b.id, rcB.body.data.id)).status).toBe(409);
    expect((await row(b.id)).status).toBe('publicado');
  });

  it('regras determinísticas valem para o recibo da revisão: imagem sem base de direito barra', async () => {
    const a = await published();
    const caso = await acceptedCase(a.id);
    const img = { url: 'https://example.org/i.jpg', origem: 'propria', credito: 'Loyalty News', baseDeDireito: 'pendente', textoAlternativo: 'Descrição da imagem' };
    await revise(a.id, 1, { corpo: 'Texto corrigido.', imagem: img, casoCorrecaoId: caso });
    const r = await receipt(a.id, 2);
    expect(r.status).toBe(422);
    expect(r.body.error.details.join(' ')).toMatch(/imagem sem base de direito/);
  });
});
