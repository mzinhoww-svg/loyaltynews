/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyStagingSeed, checkStagingSeed, SEED_LABEL } from '@ln/workers/seed-staging';
import { call, makeApp } from '../_lib/testkit';
import { CONTEUDO } from '../_lib/site/content';
import * as pubSite from '../publico/site/route';
import * as pubSitemap from '../publico/site/sitemap/route';
import * as pubMaterias from '../publico/materias/route';
import * as pubAgenda from '../publico/agenda/route';
import { schema } from '@ln/db';

// O seed de staging precisa produzir documentos que o CONTRATO do site aceita e que o Portal enxerga pelas rotas públicas.
let app: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  app = await makeApp();
  await applyStagingSeed(app.db as any, { APP_ENV: 'staging' }, app.deps.now());
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('seed de staging nas rotas públicas', () => {
  it('home e SEO do seed passam pelos esquemas do contrato do site', async () => {
    const docs = await app.db.select().from(schema.siteDocumentos);
    expect(docs.map((d) => d.tipo).sort()).toEqual(['home', 'seo_global']);
    for (const d of docs) expect(CONTEUDO[d.tipo as keyof typeof CONTEUDO]!.safeParse(d.conteudo).success, d.tipo).toBe(true);
  });

  it('o Portal vê a home resolvida (destaques, editoria, últimas e agenda): matérias e eventos rotulados, seções sem rótulo, e o SEO noindex', async () => {
    const r = await call(pubSite.GET, 'GET', {});
    expect(r.status).toBe(200);
    const { home, seo } = r.body.data;
    const por = (id: string) => home.blocos.find((b: any) => b.id === id);
    expect(por('topo').materias).toHaveLength(3);
    expect(por('mercado').materias.length).toBeGreaterThan(0);
    expect(por('ultimas').materias).toHaveLength(5); // as cinco publicadas (a sexta é rascunho)
    expect(por('agenda').eventos).toHaveLength(3);
    for (const m of [...por('topo').materias, ...por('ultimas').materias]) expect(m.titulo).toContain(SEED_LABEL);
    for (const e of por('agenda').eventos) expect(e.titulo).toContain(SEED_LABEL);
    // N-02: o rótulo fica no conteúdo, nunca no nome da seção
    for (const b of home.blocos) if (typeof b.titulo === 'string') expect(b.titulo).not.toContain(SEED_LABEL);
    expect(seo).toMatchObject({ indexacao: 'noindex' });
    expect(seo.tituloPadrao).toContain(SEED_LABEL);
  });

  it('listagem pública só mostra as publicadas (rótulo em todas); sitemap vazio porque o SEO é noindex', async () => {
    const l = await call(pubMaterias.GET, 'GET', {});
    expect(l.body.data).toHaveLength(5);
    expect(l.body.data.every((m: any) => m.titulo.startsWith(SEED_LABEL) && m.resumo.includes(SEED_LABEL))).toBe(true);
    const s = await call(pubSitemap.GET, 'GET', {});
    expect(s.body.data).toEqual({ indexacao: 'noindex', urls: [] });
    const ag = await call(pubAgenda.GET, 'GET', {});
    expect(ag.body.data).toHaveLength(3);
  });

  it('a conferência do seed passa neste banco', async () => {
    expect((await checkStagingSeed(app.db as any)).ok).toBe(true);
  });
});
