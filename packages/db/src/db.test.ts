import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EDITORIAS } from '@ln/contracts';
import { createTestDb } from './testing';
import * as s from './schema';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe('migrações em PGlite', () => {
  // A carga dos 47 formatos (com preço) é testada pela Frente 10 a partir do catálogo de @ln/commercial.
  it('carregam as 10 editorias', async () => {
    await t.db.insert(s.editorias).values(EDITORIAS.map((e) => ({ slug: e.slug, nome: e.nome })));
    expect(await t.db.$count(s.editorias)).toBe(10);
  });

  it('matéria com a assinatura institucional é gravada; outra assinatura é recusada pelo banco', async () => {
    await t.db.insert(s.articles).values({ id: 'a1', slug: 'm1', titulo: 'T', editoria: 'pontos', corpo: 'C' });
    const [a] = await t.db.select().from(s.articles).where(eq(s.articles.id, 'a1'));
    expect(a?.assinatura).toBe('Redação Loyalty News');
    expect(a?.status).toBe('rascunho');
    await expect(
      t.db.insert(s.articles).values({ id: 'a2', slug: 'm2', titulo: 'T', editoria: 'pontos', corpo: 'C', assinatura: 'Fulano' }),
    ).rejects.toThrow();
  });

  it('publieditorial sem rótulo é recusado', async () => {
    await expect(
      t.db.insert(s.articles).values({ id: 'a3', slug: 'm3', titulo: 'T', editoria: 'mercado', corpo: 'C', patrocinado: true }),
    ).rejects.toThrow();
  });

  it('fonte só com acesso público', async () => {
    await t.db.insert(s.sources).values({ id: 'f1', nome: 'Fonte', url: 'https://example.org', tipo: 'site' });
    await expect(
      t.db.insert(s.sources).values({ id: 'f2', nome: 'Paywall', url: 'https://example.org/p', tipo: 'site', acesso: 'assinante' }),
    ).rejects.toThrow();
  });
});
