/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../_lib/testkit';
import * as lista from './documentos/route';
import * as doc from './documentos/[tipo]/route';
import * as rascunho from './documentos/[tipo]/rascunho/route';
import * as preview from './documentos/[tipo]/preview/route';
import * as publicar from './documentos/[tipo]/publicar/route';
import * as agendamento from './documentos/[tipo]/agendamento/route';
import * as rollback from './documentos/[tipo]/rollback/route';
import * as redirects from './redirects/route';
import * as redirect from './redirects/[id]/route';
import * as pubSite from '../publico/site/route';
import * as pubRedirects from '../publico/site/redirects/route';
import * as pubSitemap from '../publico/site/sitemap/route';

let app: Awaited<ReturnType<typeof makeApp>>;
let editor: Actor;
let chefe: Actor;
let admin: Actor;
let revisor: Actor;
let leitor: Actor;

const put = (tipo: string, conteudo: unknown, as: Actor | null) => call(rascunho.PUT, 'PUT', { params: { tipo }, body: { conteudo }, as });
const pub = (tipo: string, body: unknown = {}, as: Actor | null = chefe) => call(publicar.POST, 'POST', { params: { tipo }, body, as });
const atual = (tipo: string, as: Actor | null = chefe) => call(doc.GET, 'GET', { params: { tipo }, as });
const publico = () => call(pubSite.GET, 'GET', {});

const home = (over: Record<string, unknown> = {}) => ({
  blocos: [
    { tipo: 'destaque', id: 'topo', titulo: 'Destaques', materiaSlugs: ['materia-no-ar'] },
    { tipo: 'ultimas', id: 'ultimas', limite: 5 },
    { tipo: 'publicidade', id: 'anuncio-1', posicao: 'TOP' },
  ],
  ...over,
});
const menu = (rotulo = 'Mercado') => ({ itens: [{ rotulo, destino: '/editoria/mercado', filhos: [{ rotulo: 'Bancos', destino: '/editoria/bancos' }] }] });
const seo = (over: Record<string, unknown> = {}) => ({
  tituloPadrao: 'Loyalty News', descricaoPadrao: 'Notícias de fidelidade e coalizões.', indexacao: 'indexar', sitemap: { incluirMaterias: true },
  dadosEstruturados: { organizacao: { nome: 'Loyalty News', url: 'https://loyaltynews.example', logoUrl: 'https://loyaltynews.example/logo.png', sameAs: ['https://linkedin.com/company/ln'] } },
  ...over,
});

const artigo = (slug: string, status: string, extra: Record<string, unknown> = {}) =>
  app.db.insert(schema.articles).values({
    id: slug, slug, titulo: `Título ${slug}`, editoria: 'pontos', corpo: 'Corpo', resumo: 'Resumo da matéria', status: status as any,
    publicadoEm: status === 'publicado' ? new Date('2026-11-20T10:00:00Z') : null, ...extra,
  } as any);

beforeAll(async () => {
  app = await makeApp();
  [editor, chefe, admin, revisor, leitor] = [
    await app.actor('editor'), await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('revisor'), await app.actor('leitor'),
  ];
  await artigo('materia-no-ar', 'publicado');
  await artigo('materia-rascunho', 'rascunho');
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('acesso por papel', () => {
  it('sem sessão 401; leitor 403; revisor lê mas não escreve', async () => {
    expect((await call(lista.GET, 'GET', {})).status).toBe(401);
    expect((await call(lista.GET, 'GET', { as: leitor })).status).toBe(403);
    expect((await call(lista.GET, 'GET', { as: revisor })).status).toBe(200);
    expect((await put('seo_global', seo(), revisor)).status).toBe(403);
    expect((await put('seo_global', seo(), leitor)).status).toBe(403);
  });

  it('sessão só de senha (sem MFA) não entra', async () => {
    const solo = await app.passwordOnly('editor_chefe');
    expect((await put('menu_principal', menu(), solo)).status).toBeGreaterThanOrEqual(401);
    expect((await put('menu_principal', menu(), solo)).status).toBeLessThan(404);
  });

  it('home e menus: editor NÃO escreve; chefia e admin sim. SEO e links internos: editor escreve, mas NÃO publica', async () => {
    expect((await put('home', home(), editor)).status).toBe(403);
    expect((await put('menu_principal', menu(), editor)).status).toBe(403);
    expect((await put('menu_rodape', menu(), editor)).status).toBe(403);
    expect((await put('seo_global', seo(), editor)).status).toBe(200);
    expect((await put('links_internos', { regras: [{ termo: 'Smiles', destino: '/empresas/smiles' }] }, editor)).status).toBe(200);
    expect((await pub('seo_global', {}, editor)).status).toBe(403);
    expect((await put('home', home(), chefe)).status).toBe(200);
    expect((await put('menu_principal', menu(), admin)).status).toBe(200);
  });

  it('tipo inexistente: 404', async () => {
    expect((await atual('nada')).status).toBe(404);
    expect((await put('nada', {}, chefe)).status).toBe(404);
  });
});

describe('validação estrita do conteúdo', () => {
  it('recusa campos extras, HTML/scripts em destino, caminhos reservados, ids e posições repetidas', async () => {
    const ruins: [string, unknown][] = [
      ['home', { blocos: [], extra: 1 }],
      ['home', { blocos: [] }],
      ['home', { blocos: [{ tipo: 'ultimas', id: 'a', html: '<b>' }] }],
      ['home', { blocos: [{ tipo: 'ultimas', id: 'a' }, { tipo: 'ultimas', id: 'a' }] }],
      ['home', { blocos: [{ tipo: 'destaque', id: 'a', materiaSlugs: ['x'] }, { tipo: 'destaque', id: 'b', materiaSlugs: ['x'] }] }],
      ['home', { blocos: [{ tipo: 'publicidade', id: 'a', posicao: 'TOP' }, { tipo: 'publicidade', id: 'b', posicao: 'TOP' }] }],
      ['home', { blocos: [{ tipo: 'publicidade', id: 'a', posicao: 'INVENTADA' }] }],
      ['home', { blocos: [{ tipo: 'lista_editoria', id: 'a', editoria: 'inventada' }] }],
      ['home', { blocos: [{ tipo: 'destaque', id: 'a', materiaSlugs: [] }] }],
      ['home', { blocos: [{ tipo: 'destaque', id: 'a', materiaSlugs: Array.from({ length: 9 }, (_, i) => `m-${i}`) }] }],
      ['menu_principal', { itens: [{ rotulo: 'X', destino: 'javascript:alert(1)' }] }],
      ['menu_principal', { itens: [{ rotulo: 'X', destino: '//evil.example' }] }],
      ['menu_principal', { itens: [{ rotulo: 'X', destino: '/api/auth/sign-in' }] }],
      ['menu_principal', { itens: [{ rotulo: 'X', destino: '/studio' }] }],
      ['menu_principal', { itens: [{ rotulo: 'X', destino: 'ftp://x.example' }] }],
      ['menu_principal', { itens: [] }],
      ['menu_principal', { itens: Array.from({ length: 13 }, (_, i) => ({ rotulo: `i${i}`, destino: '/a' })) }],
      ['seo_global', seo({ indexacao: 'talvez' })],
      ['seo_global', seo({ tituloPadrao: 'x'.repeat(71) })],
      ['seo_global', seo({ imagemOgUrl: 'javascript:alert(1)' })],
      ['seo_global', seo({ scripts: ['<script>'] })],
      ['seo_global', seo({ dadosEstruturados: { organizacao: { nome: 'N', url: 'nao-e-url' } } })],
      ['links_internos', { regras: [{ termo: 'Smiles', destino: '/a' }, { termo: 'smiles', destino: '/b' }] }],
      ['links_internos', { regras: [{ termo: 'Smiles', destino: 'https://externo.example' }] }],
    ];
    for (const [tipo, conteudo] of ruins) {
      const r = await put(tipo, conteudo, chefe);
      expect(r.status, `${tipo} ${JSON.stringify(conteudo).slice(0, 80)}`).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await call(rascunho.PUT, 'PUT', { params: { tipo: 'seo_global' }, body: { conteudo: seo(), x: 1 }, as: chefe })).status).toBe(400);
  });
});

describe('rascunho, preview e pendências', () => {
  it('salvar de novo substitui o rascunho (um por tipo); preview resolve matéria fixada e dimensão da posição', async () => {
    expect((await put('home', home(), chefe)).status).toBe(200);
    expect((await put('home', home(), chefe)).status).toBe(200);
    const rows = (await app.db.select().from(schema.siteDocumentos)).filter((r) => r.tipo === 'home' && r.estado === 'rascunho');
    expect(rows).toHaveLength(1);
    const p = await call(preview.GET, 'GET', { params: { tipo: 'home' }, as: chefe });
    expect(p.status).toBe(200);
    expect(p.body.data.publicavel).toBe(true);
    expect(p.body.data.pendencias).toEqual([]);
    const dest = p.body.data.resolvido.find((b: any) => b.tipo === 'destaque');
    expect(dest.materias.map((m: any) => m.slug)).toEqual(['materia-no-ar']);
    const ad = p.body.data.resolvido.find((b: any) => b.tipo === 'publicidade');
    expect(ad.dimensao.desktop).toBe('1280x150');
  });

  it('preview sem rascunho: 404', async () => {
    expect((await call(preview.GET, 'GET', { params: { tipo: 'menu_rodape' }, as: chefe })).status).toBe(404);
  });

  it('matéria fixada inexistente, em rascunho ou posição sem dimensão ⇒ pendência no preview e 422 ao publicar; nada é publicado', async () => {
    await put('home', {
      blocos: [
        { tipo: 'destaque', id: 'a', materiaSlugs: ['nao-existe', 'materia-rascunho', 'materia-no-ar'] },
        { tipo: 'publicidade', id: 'b', posicao: 'HOME_BETWEEN' },
      ],
    }, chefe);
    const p = await call(preview.GET, 'GET', { params: { tipo: 'home' }, as: chefe });
    expect(p.body.data.publicavel).toBe(false);
    expect(p.body.data.pendencias.map((x: any) => x.path).sort()).toEqual(['blocos.b.posicao', 'materiaSlugs.materia-rascunho', 'materiaSlugs.nao-existe']);
    const r = await pub('home');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('PENDENCIAS');
    expect((await app.db.select().from(schema.siteDocumentos)).filter((x) => x.tipo === 'home' && x.estado === 'publicado')).toHaveLength(0);
    await put('home', home(), chefe); // volta ao rascunho válido
  });

  it('publicar sem rascunho: 409', async () => {
    expect((await pub('menu_rodape')).status).toBe(409);
  });
});

describe('publicar, versionar, agendar e rollback', () => {
  it('antes de publicar, o público não vê nada; publicar cria v1; a seguinte substitui a anterior (v2) e o público vê a vigente', async () => {
    const v0 = await publico();
    expect(v0.body.data.home).toBeNull();
    expect(v0.body.data.menus).toEqual({ principal: null, rodape: null });
    expect(v0.body.data.seo).toBeNull();

    await put('menu_principal', menu('Mercado'), chefe);
    const a = await pub('menu_principal');
    expect(a.status).toBe(200);
    expect(a.body.data).toMatchObject({ tipo: 'menu_principal', versao: 1, estado: 'publicado', efetivoAgora: true });
    await put('menu_principal', menu('Mercado 2'), chefe);
    const b = await pub('menu_principal');
    expect(b.body.data.versao).toBe(2);
    const g = await atual('menu_principal');
    expect(g.body.data.vigente.versao).toBe(2);
    expect(g.body.data.vigente.conteudo.itens[0].rotulo).toBe('Mercado 2');
    expect(g.body.data.rascunho).toBeNull();
    const versoes = await call(lista.GET, 'GET', { query: { tipo: 'menu_principal' }, as: chefe });
    expect(versoes.body.data.map((v: any) => [v.versao, v.estado])).toEqual([[2, 'publicado'], [1, 'substituido']]);
    expect((await publico()).body.data.menus.principal.itens[0].rotulo).toBe('Mercado 2');
  });

  it('home pública: destaque resolvido com campos públicos; matéria que saiu do ar some sem quebrar; posição com dimensão reservada', async () => {
    await put('home', home(), chefe);
    expect((await pub('home')).status).toBe(200);
    const h = (await publico()).body.data.home;
    expect(h.versao).toBe(1);
    const dest = h.blocos.find((b: any) => b.tipo === 'destaque');
    expect(dest.materias).toHaveLength(1);
    expect(Object.keys(dest.materias[0]).sort()).toEqual(['editoria', 'publicadoEm', 'resumo', 'slug', 'subtitulo', 'titulo']);
    expect(h.blocos.find((b: any) => b.tipo === 'publicidade').dimensao).toEqual({ desktop: '1280x150', mobile: ['320x100', '300x250'] });
    await app.db.update(schema.articles).set({ status: 'despublicado' as any }).where(eq(schema.articles.slug, 'materia-no-ar'));
    const h2 = (await publico()).body.data.home;
    expect(h2.blocos.find((b: any) => b.tipo === 'destaque').materias).toEqual([]);
    await app.db.update(schema.articles).set({ status: 'publicado' as any }).where(eq(schema.articles.slug, 'materia-no-ar'));
  });

  it('agendar: não aparece antes da hora, aparece sozinho na hora; um agendamento por tipo; publicar agora com agendamento pendente é recusado', async () => {
    await put('menu_rodape', menu('Rodapé A'), chefe);
    await pub('menu_rodape');
    await put('menu_rodape', menu('Rodapé B'), chefe);
    const futuro = new Date(app.clock.now.getTime() + 2 * 3_600_000).toISOString();
    const ag = await pub('menu_rodape', { agendarPara: futuro });
    expect(ag.status).toBe(202);
    expect(ag.body.data).toMatchObject({ estado: 'agendado', versao: 2, efetivoAgora: false });
    expect((await publico()).body.data.menus.rodape.itens[0].rotulo).toBe('Rodapé A');

    await put('menu_rodape', menu('Rodapé C'), chefe);
    const dup = await pub('menu_rodape', { agendarPara: new Date(app.clock.now.getTime() + 3 * 3_600_000).toISOString() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('AGENDAMENTO_EXISTENTE');
    const agora = await pub('menu_rodape');
    expect(agora.status).toBe(409);
    expect(agora.body.error.code).toBe('AGENDAMENTO_PENDENTE');

    const g = await atual('menu_rodape');
    expect(g.body.data.agendado.versao).toBe(2);
    expect(g.body.data.vigente.versao).toBe(1);

    const t0 = app.clock.now;
    app.clock.now = new Date(t0.getTime() + 3 * 3_600_000);
    expect((await publico()).body.data.menus.rodape.itens[0].rotulo).toBe('Rodapé B');
    expect((await atual('menu_rodape')).body.data.vigente.versao).toBe(2);
    app.clock.now = t0;
    const cancel = await call(agendamento.DELETE, 'DELETE', { params: { tipo: 'menu_rodape' }, as: chefe });
    expect(cancel.status).toBe(409); // há rascunho C em edição
    expect(cancel.body.error.code).toBe('RASCUNHO_EXISTENTE');
  });

  it('agendamento: data passada/curta/além de 365 dias ⇒ 422; formato inválido ⇒ 400', async () => {
    await put('seo_global', seo(), chefe);
    const now = app.clock.now.getTime();
    for (const quando of [new Date(now - 1000).toISOString(), new Date(now + 30_000).toISOString(), new Date(now + 400 * 86_400_000).toISOString()]) {
      const r = await pub('seo_global', { agendarPara: quando });
      expect(r.status, quando).toBe(422);
      expect(r.body.error.code).toBe('AGENDAMENTO_INVALIDO');
    }
    expect((await pub('seo_global', { agendarPara: 'amanhã' })).status).toBe(400);
    expect((await pub('seo_global', { extra: 1 })).status).toBe(400);
  });

  it('cancelar agendamento devolve o conteúdo a rascunho (sem versão); só a chefia; sem agendamento ⇒ 404', async () => {
    await put('links_internos', { regras: [{ termo: 'Latam Pass', destino: '/empresas/latam-pass' }] }, chefe);
    const ag = await pub('links_internos', { agendarPara: new Date(app.clock.now.getTime() + 3_600_000 * 5).toISOString() });
    expect(ag.status).toBe(202);
    expect((await call(agendamento.DELETE, 'DELETE', { params: { tipo: 'links_internos' }, as: editor })).status).toBe(403);
    const c = await call(agendamento.DELETE, 'DELETE', { params: { tipo: 'links_internos' }, as: chefe });
    expect(c.status).toBe(200);
    expect(c.body.data).toMatchObject({ estado: 'rascunho', versao: null, publicarEm: null });
    expect((await call(agendamento.DELETE, 'DELETE', { params: { tipo: 'links_internos' }, as: chefe })).status).toBe(404);
  });

  it('rollback cria NOVA versão com o conteúdo antigo; histórico preservado; versão inexistente ⇒ 404; revalida pendências', async () => {
    await put('menu_principal', menu('Mercado 3'), chefe);
    await pub('menu_principal'); // v3
    const r = await call(rollback.POST, 'POST', { params: { tipo: 'menu_principal' }, body: { versao: 1 }, as: chefe });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ versao: 4, estado: 'publicado', nota: 'rollback para v1' });
    const g = await atual('menu_principal');
    expect(g.body.data.vigente.conteudo.itens[0].rotulo).toBe('Mercado');
    const versoes = await call(lista.GET, 'GET', { query: { tipo: 'menu_principal' }, as: chefe });
    expect(versoes.body.data.map((v: any) => [v.versao, v.estado])).toEqual([[4, 'publicado'], [3, 'substituido'], [2, 'substituido'], [1, 'substituido']]);
    expect((await call(rollback.POST, 'POST', { params: { tipo: 'menu_principal' }, body: { versao: 99 }, as: chefe })).status).toBe(404);
    expect((await call(rollback.POST, 'POST', { params: { tipo: 'menu_principal' }, body: { versao: 0 }, as: chefe })).status).toBe(400);
    expect((await call(rollback.POST, 'POST', { params: { tipo: 'menu_principal' }, body: { versao: 1 }, as: editor })).status).toBe(403);

    // rollback para uma home cuja matéria fixada saiu do ar: recusado
    await artigo('materia-temp', 'publicado');
    await put('home', { blocos: [{ tipo: 'destaque', id: 'a', materiaSlugs: ['materia-temp'] }] }, chefe);
    await pub('home'); // v2
    await put('home', home(), chefe);
    await pub('home'); // v3
    await app.db.update(schema.articles).set({ status: 'despublicado' as any }).where(eq(schema.articles.slug, 'materia-temp'));
    const bad = await call(rollback.POST, 'POST', { params: { tipo: 'home' }, body: { versao: 2 }, as: chefe });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('PENDENCIAS');
  });

  it('publicar e rollback ficam na auditoria com ator, tipo e versão', async () => {
    const logs = await app.db.select().from(schema.auditLog);
    const acoes = logs.filter((l) => l.resource === 'site').map((l) => l.action);
    for (const a of ['site.rascunho_salvo', 'site.publicado', 'site.agendado', 'site.rollback', 'site.agendamento_cancelado']) expect(acoes, a).toContain(a);
    const rb = logs.find((l) => l.action === 'site.rollback')!;
    expect(rb.actorId).toBe(chefe.id);
    expect(rb.detalhe).toMatchObject({ tipo: 'menu_principal', de: 1, para: 4 });
  });
});

describe('SEO público, JSON-LD e sitemap', () => {
  it('sem SEO publicado o sitemap é vazio e indexação "noindex" por padrão seguro', async () => {
    const s = await call(pubSitemap.GET, 'GET', {});
    expect(s.body.data).toEqual({ indexacao: 'noindex', urls: [] });
  });

  it('SEO publicado: expõe só os campos públicos + JSON-LD Organization; sitemap lista matérias publicadas e nenhuma outra', async () => {
    await put('seo_global', seo(), chefe);
    expect((await pub('seo_global')).status).toBe(200);
    const s = (await publico()).body.data.seo;
    expect(s).toMatchObject({ tituloPadrao: 'Loyalty News', indexacao: 'indexar' });
    expect(s.jsonLd).toEqual({
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Loyalty News', url: 'https://loyaltynews.example',
      logo: 'https://loyaltynews.example/logo.png', sameAs: ['https://linkedin.com/company/ln'],
    });
    const m = await call(pubSitemap.GET, 'GET', {});
    expect(m.body.data.indexacao).toBe('indexar');
    const locs = m.body.data.urls.map((u: any) => u.loc);
    expect(locs).toContain('/noticia/materia-no-ar');
    expect(locs).not.toContain('/noticia/materia-rascunho');
    expect(locs).not.toContain('/noticia/materia-temp');
  });

  it('noindex ou incluirMaterias=false ⇒ sitemap vazio', async () => {
    await put('seo_global', seo({ indexacao: 'noindex' }), chefe);
    await pub('seo_global');
    expect((await call(pubSitemap.GET, 'GET', {})).body.data).toEqual({ indexacao: 'noindex', urls: [] });
    await put('seo_global', seo({ sitemap: { incluirMaterias: false } }), chefe);
    await pub('seo_global');
    expect((await call(pubSitemap.GET, 'GET', {})).body.data.urls).toEqual([]);
  });

  it('links internos publicados chegam ao público; rascunho não', async () => {
    await put('links_internos', { regras: [{ termo: 'Smiles', destino: '/empresas/smiles' }] }, editor);
    expect((await publico()).body.data.linksInternos).toEqual([]);
    expect((await pub('links_internos')).status).toBe(200);
    expect((await publico()).body.data.linksInternos).toEqual([{ termo: 'Smiles', destino: '/empresas/smiles' }]);
  });

  it('o público não vê rascunhos, notas, autores nem ids; resposta com cache curto', async () => {
    const r = await publico();
    expect(r.headers.get('cache-control')).toContain('max-age=60');
    const txt = JSON.stringify(r.body);
    expect(txt).not.toContain(chefe.id);
    expect(txt).not.toContain('criadoPor');
    expect(txt).not.toContain('rollback para');
  });
});

describe('redirects', () => {
  const mk = (b: unknown, as: Actor | null = chefe) => call(redirects.POST, 'POST', { body: b, as });

  it('RBAC: editor não cria; chefia cria/altera/desativa; só admin exclui', async () => {
    expect((await mk({ origem: '/velho', destino: '/novo' }, editor)).status).toBe(403);
    const c = await mk({ origem: '/velho', destino: '/novo' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ origem: '/velho', destino: '/novo', codigo: 301, ativo: true });
    expect((await call(redirects.GET, 'GET', { as: revisor })).status).toBe(200);
    const id = c.body.data.id;
    expect((await call(redirect.PATCH, 'PATCH', { params: { id }, body: { codigo: 302 }, as: chefe })).body.data.codigo).toBe(302);
    expect((await call(redirect.DELETE, 'DELETE', { params: { id }, as: chefe })).status).toBe(403);
    expect((await call(redirect.DELETE, 'DELETE', { params: { id }, as: admin })).status).toBe(204);
    expect((await call(redirect.DELETE, 'DELETE', { params: { id }, as: admin })).status).toBe(404);
  });

  it('validação: origem repetida (409), origem = destino, caminhos reservados, destino externo só http(s), campos extras', async () => {
    expect((await mk({ origem: '/a', destino: '/b' })).status).toBe(201);
    expect((await mk({ origem: '/a', destino: '/c' })).status).toBe(409);
    for (const bad of [
      { origem: '/x', destino: '/x' }, { origem: '/api/x', destino: '/y' }, { origem: '/studio', destino: '/y' }, { origem: 'x', destino: '/y' }, { origem: '//x', destino: '/y' },
      { origem: '/p', destino: 'javascript:alert(1)' }, { origem: '/p', destino: '/api/auth' }, { origem: '/p', destino: '/q', codigo: 307 }, { origem: '/p', destino: '/q', extra: 1 },
    ]) {
      const r = await mk(bad);
      expect([400, 422], JSON.stringify(bad)).toContain(r.status);
    }
    expect((await mk({ origem: '/ext', destino: 'https://parceiro.example/pagina' })).status).toBe(201);
  });

  it('laço e cadeia longa demais: 409 REDIRECT_LOOP', async () => {
    expect((await mk({ origem: '/l1', destino: '/l2' })).status).toBe(201);
    const direto = await mk({ origem: '/l2', destino: '/l1' });
    expect(direto.status).toBe(409);
    expect(direto.body.error.code).toBe('REDIRECT_LOOP');
    expect((await mk({ origem: '/l2', destino: '/l3' })).status).toBe(201);
    expect((await mk({ origem: '/l3', destino: '/l1' })).body.error.code).toBe('REDIRECT_LOOP');
    // cadeia longa: c0→c1→…→c10 (10 saltos) passa; mais um não
    for (let i = 0; i < 10; i++) expect((await mk({ origem: `/c${i}`, destino: `/c${i + 1}` })).status, `c${i}`).toBe(201);
    const longa = await mk({ origem: '/c-1', destino: '/c0' });
    expect(longa.status).toBe(409);
  });

  it('alterar um redirect existente também checa laço; desativar sai da lista pública', async () => {
    const a = await mk({ origem: '/p1', destino: '/p2' });
    const b = await mk({ origem: '/p2', destino: '/p3' });
    const laco = await call(redirect.PATCH, 'PATCH', { params: { id: b.body.data.id }, body: { destino: '/p1' }, as: chefe });
    expect(laco.status).toBe(409);
    expect((await call(redirect.PATCH, 'PATCH', { params: { id: a.body.data.id }, body: {}, as: chefe })).status).toBe(400);
    expect((await call(redirect.PATCH, 'PATCH', { params: { id: 'nada' }, body: { ativo: false }, as: chefe })).status).toBe(404);
    expect((await call(pubRedirects.GET, 'GET', {})).body.data.map((r: any) => r.origem)).toContain('/p1');
    await call(redirect.PATCH, 'PATCH', { params: { id: a.body.data.id }, body: { ativo: false }, as: chefe });
    const lista2 = (await call(pubRedirects.GET, 'GET', {})).body.data;
    expect(lista2.map((r: any) => r.origem)).not.toContain('/p1');
    expect(Object.keys(lista2[0]).sort()).toEqual(['codigo', 'destino', 'origem']);
  });
});
