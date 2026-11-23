// A loja PostgreSQL tem de passar a suíte de contrato da porta EditorialStore (Frente 06).
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { runEditorialStoreContract, sampleArticle } from '@ln/editorial/testing';
import { createTestDb, isRealTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { PgEditorialStore } from './editorial-store';

// Migra uma vez e reaproveita o banco pronto (dump) em cada caso: a fábrica roda antes de CADA teste e exige loja vazia.
let template: Blob | File | undefined;
async function freshDb(): Promise<{ db: Db; client: PGlite }> {
  if (isRealTestDb()) {
    const t = await createTestDb(); // PostgreSQL real: banco clonado do modelo; client.close() apaga o banco
    return { db: t.db as unknown as Db, client: t.client as unknown as PGlite };
  }
  if (!template) {
    const base = await createTestDb();
    template = await base.client.dumpDataDir('none');
    await base.close();
  }
  const client = new PGlite({ loadDataDir: template });
  await client.waitReady;
  return { db: drizzle(client, { schema }) as unknown as Db, client };
}

runEditorialStoreContract('PgEditorialStore (PGlite)', async () => {
  const { db, client } = await freshDb();
  const store = new PgEditorialStore(db);
  // armFault: prova o rollback da publicação atômica (falha injetada dentro da transação)
  return { store, teardown: () => client.close(), armFault: (step) => store.armFault(step) };
});

describe('propriedades próprias da loja PostgreSQL', () => {
  it('auditoria é somente-acréscimo também no banco (UPDATE e DELETE recusados)', async () => {
    const { db, client } = await freshDb();
    const store = new PgEditorialStore(db);
    await store.appendAudit({ at: '2026-11-23T12:00:00.000Z', userId: null, action: 'a', target: 't' });
    await expect(client.exec(`UPDATE editorial_audit SET at = 'x'`)).rejects.toThrow(/append-only/);
    await expect(client.exec(`DELETE FROM editorial_audit`)).rejects.toThrow(/append-only/);
    expect(await store.listAudit()).toHaveLength(1);
    await client.close();
  });

  it('colunas escalares acompanham o registro (índice por status e editoria)', async () => {
    const { db, client } = await freshDb();
    const store = new PgEditorialStore(db);
    await store.putArticle(sampleArticle('a1', { status: 'bloqueado', editoria: 'mercado' }));
    await store.putArticle(sampleArticle('a1', { status: 'aprovado', editoria: 'pontos' }));
    const r = await client.query<{ status: string; editoria: string }>('SELECT status, editoria FROM editorial_article');
    expect(r.rows).toEqual([{ status: 'aprovado', editoria: 'pontos' }]);
    await client.close();
  });

  it('data inválida rejeita a promessa (nunca escrita parcial)', async () => {
    const { db, client } = await freshDb();
    const store = new PgEditorialStore(db);
    await expect(store.putArticle(sampleArticle('a2', { updatedAt: 'não é data' }))).rejects.toThrow();
    expect(await store.getArticle('a2')).toBeUndefined();
    await client.close();
  });
});
