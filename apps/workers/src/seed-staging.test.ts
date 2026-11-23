import { describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { SEED_LABEL, SEED_PREFIX, SeedRefused, applyStagingSeed, assertStaging, checkStagingSeed, removeStagingSeed, run } from './seed-staging';

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
