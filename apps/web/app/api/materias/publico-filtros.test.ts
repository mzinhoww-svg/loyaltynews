/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp } from '../_lib/testkit';
import * as pubList from '../publico/materias/route';

// GET /api/publico/materias: filtro `tipo` (tipo de conteúdo), combinável com editoria, q (título OU resumo), limit e offset; `total` reflete o filtro.
let app: Awaited<ReturnType<typeof makeApp>>;
const list = (query: Record<string, string> = {}) => call(pubList.GET, 'GET', { path: '/api/publico/materias', query });
const slugs = (r: { body: { data: { slug: string }[] } }) => r.body.data.map((m) => m.slug);

beforeAll(async () => {
  app = await makeApp();
  const dia = (n: number) => new Date(Date.UTC(2026, 10, n, 10));
  const art = (slug: string, tipo: string, editoria: string, n: number, extra: Record<string, unknown> = {}) =>
    ({ id: slug, slug, titulo: `Título ${slug}`, resumo: `Resumo de ${slug}`, corpo: 'x', editoria, tipoConteudo: tipo, status: 'publicado', publicadoEm: dia(n), classeDeDado: 'public', ...extra }) as any;
  await app.db.insert(schema.articles).values([
    art('flash-1', 'flash', 'pontos', 1),
    art('flash-2', 'flash', 'bancos', 2),
    art('flash-3', 'flash', 'pontos', 3),
    art('analise-1', 'analise', 'pontos', 4),
    art('noticia-1', 'noticia', 'pontos', 5, { resumo: 'Fala de cashback e milhas' }),
    art('flash-rascunho', 'flash', 'pontos', 6, { status: 'rascunho', publicadoEm: null }),
    art('flash-interno', 'flash', 'pontos', 7, { classeDeDado: 'internal' }),
  ]);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('GET /api/publico/materias com tipo', () => {
  it('filtra por tipo no banco (não só nas 100 mais recentes): total e paginação refletem o filtro; ordem publicadoEm desc', async () => {
    const r = await list({ tipo: 'flash' });
    expect(slugs(r)).toEqual(['flash-3', 'flash-2', 'flash-1']); // sem rascunho nem interno
    expect(r.body.total).toBe(3);
    const p2 = await list({ tipo: 'flash', limit: '2', offset: '2' });
    expect([slugs(p2), p2.body.total, p2.body.limit, p2.body.offset]).toEqual([['flash-1'], 3, 2, 2]);
  });

  it('combina com editoria e q; sem tipo traz todos os tipos públicos', async () => {
    expect(slugs(await list({ tipo: 'flash', editoria: 'pontos' }))).toEqual(['flash-3', 'flash-1']);
    expect(slugs(await list({ tipo: 'flash', q: 'flash-2' }))).toEqual(['flash-2']);
    expect((await list()).body.total).toBe(5);
    expect(slugs(await list({ tipo: 'analise' }))).toEqual(['analise-1']);
    expect(slugs(await list({ tipo: 'opiniao' }))).toEqual([]); // tipo válido sem matéria: lista vazia, total 0
  });

  it('tipo inválido: erro de validação (400 VALIDATION_ERROR no padrão da API), nunca lista tudo', async () => {
    const r = await list({ tipo: 'inventado' });
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    const vazio = await list({ tipo: '' }); // tipo= vazio também é 400 (não é ignorado)
    expect([vazio.status, vazio.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('q também casa com o resumo (e continua com teto de 100 caracteres; % e _ são literais)', async () => {
    expect(slugs(await list({ q: 'cashback' }))).toEqual(['noticia-1']);
    expect(slugs(await list({ q: 'Título noticia' }))).toEqual(['noticia-1']);
    expect((await list({ q: '%' })).body.total).toBe(0);
    expect((await list({ q: 'x'.repeat(101) })).status).toBe(400);
  });

  it('q aparado: espaços nas pontas não mudam o resultado; só espaços = 400 (nunca casa tudo que tem espaço); 100 caracteres aceitos', async () => {
    expect(slugs(await list({ q: '  cashback  ' }))).toEqual(['noticia-1']);
    const branco = await list({ q: '   ' });
    expect([branco.status, branco.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect((await list({ q: 'x'.repeat(100) })).status).toBe(200);
    expect((await list({ q: ` ${'x'.repeat(100)} ` })).status).toBe(200); // o teto vale para o termo aparado
  });
});
