/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import { altOf, setRasterizerForTest } from '../../_lib/creative';
import * as templates from './templates/route';
import * as preview from './preview/route';
import * as cards from './cards/route';
import * as umCard from './cards/[id]/route';
import * as png from './cards/[id]/png/route';
import * as transicao from './cards/[id]/transicao/route';

// /api/studio/creative/**: contrato fast-track/contratos/creative-studio-api.md. Nada aqui chama o mLabs (os módulos nem importam o publicador).
let app: Awaited<ReturnType<typeof makeApp>>;
let editor: Actor, editor2: Actor, chefe: Actor, revisor: Actor, leitor: Actor;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

beforeAll(async () => {
  app = await makeApp();
  const art = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, slug: id, titulo: `Programa de pontos muda regra de ${id}`, resumo: `Resumo de ${id}`, corpo: 'x', editoria: 'pontos', tipoConteudo: 'noticia', status: 'publicado', publicadoEm: new Date('2026-11-20T10:00:00Z'), classeDeDado: 'public', ...extra }) as any;
  await app.db.insert(schema.articles).values([
    art('mat-1'),
    art('ana-1', { tipoConteudo: 'analise', titulo: 'O que muda nas milhas em 2027' }),
    art('longa', { titulo: 'Manchete '.repeat(40).trim() }),
  ]);
  [editor, editor2, chefe, revisor, leitor] = await Promise.all([app.actor('editor'), app.actor('editor', 'editor2' as 'editor') /* 2º editor: a chave do cache é texto livre */, app.actor('editor_chefe'), app.actor('revisor'), app.actor('leitor')]);
}, 180_000);
afterAll(async () => {
  setRasterizerForTest(undefined);
  await app.close();
});

const novo = (body: Record<string, unknown>, as: Actor = editor) => call(cards.POST, 'POST', { body, as });
const trans = (id: string, body: Record<string, unknown>, as: Actor) => call(transicao.POST, 'POST', { params: { id }, body, as });

describe('templates e prévia', () => {
  it('templates: materia e analise, nos dois formatos; revisor lê; leitor 403; sem sessão 401', async () => {
    const r = await call(templates.GET, 'GET', { as: revisor });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: any) => [i.kind, i.formats])).toEqual([['materia', ['linkedin_landscape', 'square']], ['analise', ['linkedin_landscape', 'square']]]);
    expect((await call(templates.GET, 'GET', { as: leitor })).status).toBe(403);
    expect((await call(templates.GET, 'GET')).status).toBe(401);
  });

  it('prévia devolve o SVG como texto, determinístico (mesma entrada = mesmo sha), com alt e tamanho; NÃO grava nada', async () => {
    const body = { articleId: 'mat-1', kind: 'materia', format: 'square' };
    const a = await call(preview.POST, 'POST', { body, as: revisor });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ width: 1080, height: 1080, mock: false, refusal: null });
    expect(a.body.svg).toMatch(/^<svg/);
    expect(a.body.svg).not.toMatch(/<text[\s>]/);
    expect(a.body.svgSha256).toBe(sha(a.body.svg));
    expect(a.body.altText).toBe(altOf(a.body.svg));
    expect(a.body.altText.length).toBeGreaterThan(0);
    expect((await call(preview.POST, 'POST', { body, as: editor })).body.svgSha256).toBe(a.body.svgSha256);
    expect(await app.db.$count(schema.creativeCards)).toBe(0);
  });

  it('recusas do Growth viram 422 CREATIVE_REFUSED com details.motivo (sem_autoral, autoral_sem_selo, manchete_longa); 404 matéria; 400 entrada', async () => {
    const motivo = async (body: Record<string, unknown>) => {
      const r = await call(preview.POST, 'POST', { body, as: editor });
      expect([r.status, r.body.error.code]).toEqual([422, 'CREATIVE_REFUSED']);
      return r.body.error.details.motivo;
    };
    expect(await motivo({ articleId: 'mat-1', kind: 'analise', format: 'square' })).toBe('sem_autoral');
    expect(await motivo({ articleId: 'ana-1', kind: 'materia', format: 'square' })).toBe('autoral_sem_selo');
    expect(await motivo({ articleId: 'longa', kind: 'materia', format: 'linkedin_landscape' })).toBe('manchete_longa');
    expect((await call(preview.POST, 'POST', { body: { articleId: 'nao-existe', kind: 'materia', format: 'square' }, as: editor })).status).toBe(404);
    for (const bad of [{ articleId: 'mat-1', kind: 'x', format: 'square' }, { articleId: 'mat-1', kind: 'materia', format: 'story' }, { articleId: 'mat-1', kind: 'materia', format: 'square', extra: 1 }]) {
      expect((await call(preview.POST, 'POST', { body: bad, as: editor })).status).toBe(400);
    }
  });
});

describe('cards: criar, listar, revisar', () => {
  it('criar é idempotente por matéria + formato + SVG (201, depois 200 com o mesmo id, uma linha só); revisor não cria (403)', async () => {
    const body = { articleId: 'mat-1', kind: 'materia', format: 'linkedin_landscape' };
    const a = await novo(body);
    expect(a.status).toBe(201);
    expect(a.body.card).toMatchObject({ articleId: 'mat-1', articleTitulo: 'Programa de pontos muda regra de mat-1', estado: 'rascunho', kind: 'materia', format: 'linkedin_landscape', autoralFormato: null, criadoPor: editor.id, revisadoPor: null, motivo: null, mock: false });
    const b = await novo(body, editor2);
    expect([b.status, b.body.card.id, b.body.existente]).toEqual([200, a.body.card.id, true]);
    const par = await Promise.all(Array.from({ length: 4 }, () => novo({ ...body, format: 'square' })));
    expect(new Set(par.map((r) => r.body.card.id)).size).toBe(1);
    expect(await app.db.$count(schema.creativeCards, eq(schema.creativeCards.articleId, 'mat-1'))).toBe(2);
    expect((await novo(body, revisor)).status).toBe(403);
    const auditoria = await app.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'creative.card_criado'), eq(schema.auditLog.resourceId, a.body.card.id)));
    expect(auditoria).toHaveLength(1);
  });

  it('análise autoral: grava autoralFormato (padrão analise; explicador quando pedido)', async () => {
    const a = await novo({ articleId: 'ana-1', kind: 'analise', format: 'square', autoralFormato: 'explicador' });
    expect(a.status).toBe(201);
    expect(a.body.card).toMatchObject({ kind: 'analise', autoralFormato: 'explicador' });
    const b = await novo({ articleId: 'ana-1', kind: 'analise', format: 'linkedin_landscape' });
    expect(b.body.card.autoralFormato).toBe('analise');
  });

  it('fluxo: rascunho → em_revisao (editor) → aprovado (editor-chefe); quem criou não revisa (409 SAME_REVIEWER); editor não aprova (403); aprovado é final (409)', async () => {
    const { body } = await novo({ articleId: 'mat-1', kind: 'materia', format: 'linkedin_landscape' }); // o card já existente (rascunho)
    const id = body.card.id as string;
    expect((await trans(id, { para: 'aprovado' }, chefe)).status).toBe(409); // rascunho não vai direto para aprovado
    expect((await trans(id, { para: 'em_revisao' }, revisor)).status).toBe(403);
    const env = await trans(id, { para: 'em_revisao' }, editor);
    expect([env.status, env.body.card.estado]).toEqual([200, 'em_revisao']);
    expect((await trans(id, { para: 'aprovado' }, editor2)).status).toBe(403); // editor não tem social:publish
    const proprio = await trans(id, { para: 'aprovado' }, editor);
    expect(proprio.status).toBe(403); // editor nem chega na regra: não tem publish
    const ok = await trans(id, { para: 'aprovado' }, chefe);
    expect(ok.status).toBe(200);
    expect(ok.body.card).toMatchObject({ estado: 'aprovado', revisadoPor: chefe.id, motivo: null });
    expect(ok.body.card.revisadoEm).toBe('2026-11-22T12:00:00.000Z');
    const fim = await trans(id, { para: 'rascunho' }, editor);
    expect([fim.status, fim.body.error.code]).toEqual([409, 'INVALID_TRANSITION']);
    const trilha = await app.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'creative.card_transicao'), eq(schema.auditLog.resourceId, id)));
    expect(trilha.map((t: any) => [t.actorId, t.detalhe.de, t.detalhe.para])).toEqual([[editor.id, 'rascunho', 'em_revisao'], [chefe.id, 'em_revisao', 'aprovado']]);
  });

  it('SAME_REVIEWER: o editor-chefe que criou não aprova nem rejeita o próprio card; rejeitar exige motivo (400) e grava o motivo; rejeitado volta a rascunho', async () => {
    const c = await novo({ articleId: 'ana-1', kind: 'analise', format: 'square', autoralFormato: 'comparativo' }, chefe);
    const id = c.body.card.id as string;
    await trans(id, { para: 'em_revisao' }, chefe);
    const mesmo = await trans(id, { para: 'aprovado' }, chefe);
    expect([mesmo.status, mesmo.body.error.code]).toEqual([409, 'SAME_REVIEWER']);
    expect((await trans(id, { para: 'rejeitado' }, chefe)).body.error.code).toBe('SAME_REVIEWER');
    const admin = await app.actor('admin');
    const semMotivo = await trans(id, { para: 'rejeitado', motivo: '   ' }, admin);
    expect([semMotivo.status, semMotivo.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    const rej = await trans(id, { para: 'rejeitado', motivo: 'Manchete pouco clara' }, admin);
    expect(rej.body.card).toMatchObject({ estado: 'rejeitado', motivo: 'Manchete pouco clara', revisadoPor: admin.id });
    const volta = await trans(id, { para: 'rascunho' }, chefe);
    expect(volta.body.card).toMatchObject({ estado: 'rascunho', motivo: null, revisadoPor: null });
  });

  it('duas revisões simultâneas: só uma passa (a outra 409), e a trilha tem uma transição', async () => {
    const c = await novo({ articleId: 'mat-1', kind: 'materia', format: 'square' });
    const id = c.body.card.id as string;
    await trans(id, { para: 'em_revisao' }, editor);
    const admin = await app.actor('admin');
    const [x, y] = await Promise.all([trans(id, { para: 'aprovado' }, chefe), trans(id, { para: 'rejeitado', motivo: 'não' }, admin)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const n = await app.db.$count(schema.auditLog, and(eq(schema.auditLog.action, 'creative.card_transicao'), eq(schema.auditLog.resourceId, id)));
    expect(n).toBe(2); // em_revisao + uma revisão
  });

  it('lista com filtros estado e articleId, total do filtro e paginação; detalhe; 404; filtro inválido 400; revisor lê', async () => {
    const todos = await call(cards.GET, 'GET', { query: { limit: '100' }, as: revisor });
    expect(todos.status).toBe(200);
    expect(todos.body.total).toBe(todos.body.data.length);
    const aprov = await call(cards.GET, 'GET', { query: { estado: 'aprovado' }, as: revisor });
    expect(aprov.body.data.every((k: any) => k.estado === 'aprovado')).toBe(true);
    const ana = await call(cards.GET, 'GET', { query: { articleId: 'ana-1', limit: '1', offset: '1' }, as: revisor });
    expect([ana.body.data.length, ana.body.total, ana.body.limit, ana.body.offset]).toEqual([1, 3, 1, 1]);
    expect(ana.body.data[0].svg).toBeUndefined(); // a lista não carrega o SVG inteiro
    const det = await call(umCard.GET, 'GET', { params: { id: ana.body.data[0].id }, as: revisor });
    expect(det.body.card.id).toBe(ana.body.data[0].id);
    expect((await call(umCard.GET, 'GET', { params: { id: 'nao-existe' }, as: revisor })).status).toBe(404);
    expect((await call(cards.GET, 'GET', { query: { estado: 'publicado' }, as: revisor })).status).toBe(400);
    expect((await call(cards.GET, 'GET', { as: leitor })).status).toBe(403);
  });
});

describe('PNG', () => {
  it('rasteriza o SVG GRAVADO (real, @ln/growth/raster): image/png, attachment com o filename do RasterAsset, bytes PNG', async () => {
    setRasterizerForTest(undefined); // carrega o rasterizador real
    const c = await novo({ articleId: 'mat-1', kind: 'materia', format: 'square' });
    const res = await png.GET(new Request(`http://localhost:3000/api/studio/creative/cards/${c.body.card.id}/png`, { headers: { cookie: revisor.cookie } }), { params: Promise.resolve({ id: c.body.card.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toMatch(/^attachment; filename="ln-[a-z0-9-]+-1080x1080-[0-9a-f]{8}\.png"$/);
    expect(cd).toContain(c.body.card.svgSha256.slice(0, 8));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
  }, 60_000);

  it('sem rasterizador: 503 RASTER_UNAVAILABLE (nunca PNG falso); recusa do rasterizador: 422; card inexistente 404', async () => {
    const [k] = await app.db.select().from(schema.creativeCards).limit(1);
    setRasterizerForTest(null);
    expect((await call(png.GET, 'GET', { params: { id: k!.id }, as: revisor })).body.error.code).toBe('RASTER_UNAVAILABLE');
    setRasterizerForTest(async () => {
      const e = new Error('rasterização recusada (svg_com_texto): x') as Error & { rule: string };
      e.name = 'RasterRefusal';
      e.rule = 'svg_com_texto';
      throw e;
    });
    const r = await call(png.GET, 'GET', { params: { id: k!.id }, as: revisor });
    expect([r.status, r.body.error.code, r.body.error.details.motivo]).toEqual([422, 'RASTER_REFUSED', 'svg_com_texto']);
    expect((await call(png.GET, 'GET', { params: { id: 'nao-existe' }, as: revisor })).status).toBe(404);
    setRasterizerForTest(undefined);
  });
});

describe('isolamento', () => {
  it('nada do Creative Studio importa o publicador, o mLabs ou o adaptador real', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../_lib/creative.ts', import.meta.url), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*(import|export .* from)|import\(/.test(l)).join('\n');
    expect(imports).toMatch(/@ln\/growth/); // a checagem enxerga os imports
    expect(imports).not.toMatch(/mlabs|publisher|dashboard|\/jobs|createSocialPublisher/i);
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/createSocialPublisher|upload_media|create_post|prepare_media_upload/);
  });
});
