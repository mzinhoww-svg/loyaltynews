import { describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { HOME_TITULOS, SEED_LABEL, SEED_PREFIX, SeedRefused, applyStagingSeed, assertStaging, checkStagingSeed, fixStagingHome, removeStagingSeed, run } from './seed-staging';

const STG = { APP_ENV: 'staging' };
const NOW = new Date('2026-11-23T12:00:00Z');

describe('seed de staging', () => {
  it('só semeia com APP_ENV=staging: produção, vazio e outros valores recusam, e nada é gravado', async () => {
    for (const env of [{ APP_ENV: 'production' }, {}, { APP_ENV: 'dev' }, { APP_ENV: 'Staging' }, { APP_ENV: ' staging' }]) {
      expect(() => assertStaging(env)).toThrow(SeedRefused);
    }
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await expect(applyStagingSeed(db, { APP_ENV: 'production' }, NOW)).rejects.toThrow(/só vale em staging/);
      await expect(removeStagingSeed(db, {}, NOW)).rejects.toThrow(/só vale em staging/);
      expect(await db.select().from(schema.articles)).toHaveLength(0);
      expect(await db.select().from(schema.auditLog)).toHaveLength(0);
      const out: string[] = [];
      expect(await run(['apply'], { APP_ENV: 'production' }, (s) => out.push(s), t.db)).toBe(2);
      expect(out.join('')).toMatch(/só vale em staging/);
      expect(await run(['nada'], STG, (s) => out.push(s), t.db)).toBe(2);
    } finally {
      await t.close();
    }
  });

  it('cria o conjunto, 100% rotulado, e a conferência passa; repetir não duplica', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      const r1 = await applyStagingSeed(db, STG, NOW);
      expect(r1).toEqual({ editoriasCriadas: 10, artigos: 6, eventos: 3, documentosSite: 2 });
      const r2 = await applyStagingSeed(db, STG, NOW);
      expect(r2).toEqual({ editoriasCriadas: 0, artigos: 0, eventos: 0, documentosSite: 0 });
      const c = await checkStagingSeed(db);
      expect(c).toEqual({ ok: true, linhas: { articles: 6, agenda_events: 3, site_documentos: 2 }, problemas: [] });
      // toda linha do seed: id com prefixo e rótulo visível
      for (const a of await db.select().from(schema.articles)) {
        expect(a.id.startsWith(SEED_PREFIX)).toBe(true);
        expect([a.titulo, a.subtitulo, a.resumo, a.corpo].every((x) => x!.includes(SEED_LABEL))).toBe(true);
        expect(a.assinatura).toBe('Redação Loyalty News'); // regra do banco; o rótulo vai no texto
      }
      for (const e of await db.select().from(schema.agendaEvents)) expect([e.id.startsWith(SEED_PREFIX), e.titulo.includes(SEED_LABEL), e.local.includes(SEED_LABEL)]).toEqual([true, true, true]);
      // nada de recibo, fonte ou evidência inventados
      expect(await db.select().from(schema.articleSources)).toHaveLength(0);
      expect(await db.select().from(schema.evidences)).toHaveLength(0);
      // N-02: títulos de seção da home e nomes de editoria SEM o rótulo (o rótulo fica no conteúdo)
      const [home] = await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, `${SEED_PREFIX}site-home`));
      const titulos = (home!.conteudo as { blocos: { titulo: string }[] }).blocos.map((b) => b.titulo);
      expect(titulos).toEqual(['Destaques', 'Mercado', 'Últimas notícias', 'Agenda']);
      for (const e of await db.select().from(schema.editorias)) expect(e.nome).not.toContain(SEED_LABEL);
      // SEO do seed é noindex
      const [seo] = await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, `${SEED_PREFIX}site-seo_global`));
      expect((seo!.conteudo as { indexacao: string }).indexacao).toBe('noindex');
      // auditado
      expect((await db.select().from(schema.auditLog)).map((l) => l.action)).toEqual(['staging.seed_aplicado', 'staging.seed_aplicado']);
    } finally {
      await t.close();
    }
  });

  it('a conferência pega o que perde o rótulo ou o noindex', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await applyStagingSeed(db, STG, NOW);
      await db.update(schema.articles).set({ titulo: 'Título sem rótulo' }).where(eq(schema.articles.id, `${SEED_PREFIX}art-1`));
      await db.update(schema.siteDocumentos).set({ conteudo: { tituloPadrao: `${SEED_LABEL} x`, indexacao: 'indexar' } }).where(eq(schema.siteDocumentos.id, `${SEED_PREFIX}site-seo_global`));
      const c = await checkStagingSeed(db);
      expect(c.ok).toBe(false);
      expect(c.problemas).toEqual(expect.arrayContaining([expect.stringContaining('art-1 sem rótulo'), expect.stringContaining('precisa ser noindex')]));
      const out: string[] = [];
      expect(await run(['check'], {}, (s) => out.push(s), t.db)).toBe(1); // check é só leitura: roda em qualquer ambiente
    } finally {
      await t.close();
    }
  });

  it('N-02: a conferência recusa o rótulo de demonstração em título de seção da home e em nome de editoria', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await applyStagingSeed(db, STG, NOW);
      expect((await checkStagingSeed(db)).ok).toBe(true);
      const id = `${SEED_PREFIX}site-home`;
      const [home] = await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, id));
      const c0 = home!.conteudo as { blocos: { titulo: string }[] };
      await db.update(schema.siteDocumentos).set({ conteudo: { ...c0, blocos: c0.blocos.map((b, i) => (i === 1 ? { ...b, titulo: `${SEED_LABEL} Mercado` } : b)) } }).where(eq(schema.siteDocumentos.id, id));
      await db.update(schema.editorias).set({ nome: `${SEED_LABEL} Bancos` }).where(eq(schema.editorias.slug, 'bancos'));
      const c = await checkStagingSeed(db);
      expect(c.ok).toBe(false);
      expect(c.problemas).toEqual(expect.arrayContaining([expect.stringContaining('título de seção'), expect.stringContaining('editoria bancos')]));
    } finally {
      await t.close();
    }
  });

  it('a conferência também pega fonte/evidência ligada a matéria do seed (o seed não inventa fonte)', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await applyStagingSeed(db, STG, NOW);
      expect((await checkStagingSeed(db)).ok).toBe(true);
      await db.insert(schema.sources).values({ id: 'src-x', nome: 'Fonte inventada depois', url: 'https://example.org', tipo: 'site' });
      await db.insert(schema.evidences).values({ id: 'ev-x', sourceId: 'src-x', url: 'https://example.org/a', capturadoEm: NOW, sha256: 'c'.repeat(64) });
      await db.insert(schema.articleSources).values({ articleId: `${SEED_PREFIX}art-2`, evidenceId: 'ev-x' });
      const c = await checkStagingSeed(db);
      expect(c.ok).toBe(false);
      expect(c.problemas).toEqual([expect.stringContaining('seed-stg-art-2 do seed tem fonte/evidência ligada')]);
    } finally {
      await t.close();
    }
  });

  it('não passa por cima de home/SEO que alguém já publicou e não toca em linha que não é do seed; remover apaga só o seed', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await db.insert(schema.editorias).values({ slug: 'mercado', nome: 'Mercado & Negócios' });
      await db.insert(schema.siteDocumentos).values({ id: 'real-home', tipo: 'home', versao: 1, estado: 'publicado', conteudo: { blocos: [] }, publicadoEm: NOW, criadoPor: 'u1' });
      await db.insert(schema.articles).values({ id: 'real-art', slug: 'real', titulo: 'Matéria real', editoria: 'mercado', corpo: 'x', status: 'rascunho' });
      const r = await applyStagingSeed(db, STG, NOW);
      expect(r.documentosSite).toBe(1); // só o SEO; a home real foi preservada
      expect((await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.tipo, 'home'))).map((d) => d.id)).toEqual(['real-home']);
      const gone = await removeStagingSeed(db, STG, NOW);
      expect(gone).toEqual({ site_documentos: 1, agenda_events: 3, articles: 6 });
      expect((await db.select().from(schema.articles)).map((a) => a.id)).toEqual(['real-art']);
      expect(await db.select().from(schema.siteDocumentos).where(like(schema.siteDocumentos.id, `${SEED_PREFIX}%`))).toHaveLength(0);
      expect((await db.select().from(schema.siteDocumentos)).map((d) => d.id)).toEqual(['real-home']);
    } finally {
      await t.close();
    }
  });
});

describe('fix-home: staging JÁ semeado com a versão antiga (N-02/D-3)', () => {
  const HOME = `${SEED_PREFIX}site-home`;
  /** Simula o staging de hoje: a home do seed gravada com os títulos ANTIGOS rotulados. */
  async function homeAntiga(db: Db) {
    await applyStagingSeed(db, STG, NOW);
    const [doc] = await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, HOME));
    const c = doc!.conteudo as { blocos: Array<{ id: string; titulo: string }> };
    const antigos: Record<string, string> = { topo: 'Destaques', mercado: 'Mercado', ultimas: 'Últimas', agenda: 'Agenda' };
    await db.update(schema.siteDocumentos).set({ conteudo: { ...c, blocos: c.blocos.map((b) => ({ ...b, titulo: `${SEED_LABEL} ${antigos[b.id]}` })) } }).where(eq(schema.siteDocumentos.id, HOME));
    return doc!;
  }

  it('acerta no lugar só os títulos de seção da home do seed; o resto do documento (blocos, slugs, limites, versão, estado, datas) fica igual; auditado; check passa', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      const antes = await homeAntiga(db);
      expect((await checkStagingSeed(db)).ok).toBe(false); // o check pega o rótulo nas seções
      const r = await fixStagingHome(db, STG, NOW);
      expect(r).toEqual({ documentoDoSeed: true, titulosAlterados: 4, homePublicadaDeOutro: null, rotuloNaHomeDeOutro: 0 });
      const [depois] = await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, HOME));
      const blocos = (depois!.conteudo as { blocos: Array<Record<string, unknown>> }).blocos;
      expect(blocos.map((b) => b.titulo)).toEqual(['Destaques', 'Mercado', 'Últimas notícias', 'Agenda']);
      expect(blocos.map((b) => b.titulo)).toEqual(Object.values(HOME_TITULOS));
      const semTitulo = (x: Array<Record<string, unknown>>) => x.map(({ titulo: _t, ...resto }) => resto);
      expect(semTitulo(blocos)).toEqual(semTitulo((antes.conteudo as { blocos: Array<Record<string, unknown>> }).blocos));
      expect([depois!.versao, depois!.estado, depois!.publicadoEm?.toISOString(), depois!.nota]).toEqual([antes.versao, antes.estado, antes.publicadoEm?.toISOString(), antes.nota]);
      expect((await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'staging.seed_home_corrigida'))).length).toBe(1);
      expect(await checkStagingSeed(db)).toMatchObject({ ok: true, problemas: [] });
    } finally {
      await t.close();
    }
  });

  it('idempotente: a segunda execução não muda nada nem audita de novo; seed novo (já certo) também não muda', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await homeAntiga(db);
      await fixStagingHome(db, STG, NOW);
      expect(await fixStagingHome(db, STG, NOW)).toMatchObject({ documentoDoSeed: true, titulosAlterados: 0 });
      expect((await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'staging.seed_home_corrigida'))).length).toBe(1);
      const t2 = await createTestDb();
      try {
        const db2 = t2.db as unknown as Db;
        await applyStagingSeed(db2, STG, NOW);
        expect(await fixStagingHome(db2, STG, NOW)).toMatchObject({ documentoDoSeed: true, titulosAlterados: 0 });
      } finally {
        await t2.close();
      }
    } finally {
      await t.close();
    }
  });

  it('só staging: produção, vazio e outro valor recusam sem tocar em nada (inclusive pela CLI, saída 2)', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await homeAntiga(db);
      for (const env of [{ APP_ENV: 'production' }, {}, { APP_ENV: 'dev' }]) await expect(fixStagingHome(db, env, NOW)).rejects.toBeInstanceOf(SeedRefused);
      const out: string[] = [];
      expect(await run(['fix-home'], { APP_ENV: 'production' }, (s) => out.push(s), t.db)).toBe(2);
      const [doc] = await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, HOME));
      expect((doc!.conteudo as { blocos: Array<{ titulo: string }> }).blocos.every((b) => b.titulo.startsWith(SEED_LABEL))).toBe(true); // nada mudou
      const ok: string[] = [];
      expect(await run(['fix-home'], STG, (s) => ok.push(s), t.db)).toBe(0);
      expect(JSON.parse(ok[0]!)).toMatchObject({ titulosAlterados: 4 });
    } finally {
      await t.close();
    }
  });

  it('home em vigor de OUTRO documento (publicado pelo Studio): não é alterada; o relatório aponta o id e quantos títulos levam o rótulo; sem seed, nada a fazer', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await homeAntiga(db);
      await db.update(schema.siteDocumentos).set({ estado: 'substituido' }).where(eq(schema.siteDocumentos.id, HOME));
      const conteudo = { blocos: [{ tipo: 'ultimas', id: 'ultimas', titulo: `${SEED_LABEL} Últimas`, limite: 6 }] };
      await db.insert(schema.siteDocumentos).values({ id: 'home-studio', tipo: 'home', versao: 9, estado: 'publicado', conteudo, publicadoEm: NOW, criadoPor: 'u1' });
      const r = await fixStagingHome(db, STG, NOW);
      expect(r).toMatchObject({ documentoDoSeed: true, titulosAlterados: 4, homePublicadaDeOutro: 'home-studio', rotuloNaHomeDeOutro: 1 });
      const [studio] = await db.select().from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, 'home-studio'));
      expect(studio!.conteudo).toEqual(conteudo); // o documento do Studio não é tocado
      const t2 = await createTestDb();
      try {
        expect(await fixStagingHome(t2.db as unknown as Db, STG, NOW)).toEqual({ documentoDoSeed: false, titulosAlterados: 0, homePublicadaDeOutro: null, rotuloNaHomeDeOutro: 0 });
      } finally {
        await t2.close();
      }
    } finally {
      await t.close();
    }
  });
});
