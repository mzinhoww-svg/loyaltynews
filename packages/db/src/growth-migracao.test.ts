import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './testing';

// A migração 0024 (growth_media_uploads) é REVERSÍVEL: o down remove a tabela e o registro da migração; o up pode ser aplicado de novo.
const DIR = fileURLToPath(new URL('../drizzle/', import.meta.url));
const UP = readFileSync(`${DIR}0024_growth_media_uploads.sql`, 'utf8');
const DOWN = readFileSync(`${DIR}down/0024_growth_media_uploads.down.sql`, 'utf8');

describe('migração 0024 growth_media_uploads: subir, descer e subir de novo', () => {
  it('a tabela existe; o down a remove e tira o registro da migração; o up volta a criá-la', async () => {
    const t = await createTestDb();
    try {
      const existe = async () => (await t.client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'growth_media_uploads'`)).rows.length === 1;
      const registro = async () => Number((await t.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`)).rows[0]!.n);
      expect(await existe()).toBe(true);
      const antes = await registro();
      await t.client.exec(DOWN);
      expect(await existe()).toBe(false);
      expect(await registro()).toBe(antes - 1);
      for (const stmt of UP.split('--> statement-breakpoint')) if (stmt.trim()) await t.client.exec(stmt);
      expect(await existe()).toBe(true);
    } finally {
      await t.close();
    }
  });

  it('o down só toca em growth_media_uploads e no registro desta migração', () => {
    expect([...DOWN.matchAll(/DROP TABLE IF EXISTS (\w+);/g)].map((m) => m[1])).toEqual(['growth_media_uploads']);
    expect(DOWN).toMatch(/DELETE FROM drizzle\.__drizzle_migrations WHERE created_at = 1795448461583;/);
    expect(DOWN.replace(/--.*$/gm, '')).not.toMatch(/\bDROP (SCHEMA|DATABASE)\b|TRUNCATE/i);
  });
});
