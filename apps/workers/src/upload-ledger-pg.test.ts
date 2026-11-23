import { afterAll, describe, expect, it } from 'vitest';
import type { Db } from '@ln/auth';
import { createTestDb } from '@ln/db/testing';
import { uploadLedgerConformanceCases } from '@ln/growth/testing';
import { PgUploadLedger } from './upload-ledger-pg';

// O registro durável de envios de mídia passa INTEIRO a suíte de conformidade do Growth (a mesma do registro em memória).
describe('PgUploadLedger: conformidade com o contrato do @ln/growth', () => {
  const closers: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const c of closers) await c();
  });
  const make = async () => {
    const t = await createTestDb();
    closers.push(t.close);
    return new PgUploadLedger(t.db as unknown as Db);
  };
  for (const c of uploadLedgerConformanceCases(make)) it(c.name, c.run, 60_000);
});

describe('PgUploadLedger: durabilidade e CHECKs da tabela', () => {
  const T = '2026-11-23T12:00:00.123Z';
  const KEY = `svg:${'a'.repeat(64)}:linkedin`;

  it('a entrada sobrevive a uma nova instância (outro processo) sobre o mesmo banco; milissegundos preservados', async () => {
    const t = await createTestDb();
    try {
      const db = t.db as unknown as Db;
      await new PgUploadLedger(db).putIfAbsent(KEY, { imageId: 'img-1', at: T });
      expect(await new PgUploadLedger(db).get(KEY)).toEqual({ imageId: 'img-1', at: T });
    } finally {
      await t.close();
    }
  });

  it('os CHECKs são a segunda barreira: SQL direto com chave fora do formato ou imageId vazio é recusado pelo banco', async () => {
    const t = await createTestDb();
    try {
      const ins = (k: string, i: string) => t.client.query(`INSERT INTO growth_media_uploads (key, image_id, created_at) VALUES ($1, $2, now())`, [k, i]);
      await expect(ins('com espaço', 'i')).rejects.toThrow(/growth_media_uploads_key/);
      await expect(ins('k'.repeat(201), 'i')).rejects.toThrow(/growth_media_uploads_key/);
      await expect(ins(KEY, '')).rejects.toThrow(/growth_media_uploads_image/);
      await expect(ins(KEY, 'x'.repeat(201))).rejects.toThrow(/growth_media_uploads_image/);
      await ins(KEY, 'ok');
      await expect(ins(KEY, 'outro')).rejects.toThrow(/growth_media_uploads_pkey/); // a chave é PK (idioma do servidor não importa): a primeira vence
      const n = (await t.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM growth_media_uploads`)).rows[0]!.n;
      expect(n).toBe('1');
    } finally {
      await t.close();
    }
  });

  it('só hash, id opaco e instante: a tabela tem exatamente 3 colunas', async () => {
    const t = await createTestDb();
    try {
      const cols = (await t.client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'growth_media_uploads' ORDER BY 1`)).rows.map((r) => r.column_name);
      expect(cols).toEqual(['created_at', 'image_id', 'key']);
    } finally {
      await t.close();
    }
  });
});
