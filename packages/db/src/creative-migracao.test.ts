import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './testing';

// A migração creative_cards é REVERSÍVEL: o down remove a tabela e o registro da migração; o up pode ser aplicado de novo.
const DIR = fileURLToPath(new URL('../drizzle/', import.meta.url));
const TAG = readdirSync(DIR).find((f) => /^\d{4}_creative_cards\.sql$/.test(f))!.replace(/\.sql$/, '');
const UP = readFileSync(`${DIR}${TAG}.sql`, 'utf8');
const DOWN = readFileSync(`${DIR}down/${TAG}.down.sql`, 'utf8');
const JOURNAL = JSON.parse(readFileSync(`${DIR}meta/_journal.json`, 'utf8')) as { entries: { tag: string; when: number }[] };

describe(`migração ${TAG}: subir, descer e subir de novo`, () => {
  it('a tabela existe; o down a remove e tira o registro; o up volta a criá-la com os CHECKs', async () => {
    const t = await createTestDb();
    try {
      const existe = async () => (await t.client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'creative_cards'`)).rows.length === 1;
      const registro = async () => Number((await t.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`)).rows[0]!.n);
      expect(await existe()).toBe(true);
      const antes = await registro();
      await t.client.exec(DOWN);
      expect(await existe()).toBe(false);
      expect(await registro()).toBe(antes - 1);
      for (const stmt of UP.split('--> statement-breakpoint')) if (stmt.trim()) await t.client.exec(stmt);
      expect(await existe()).toBe(true);
      await expect(t.client.query(`INSERT INTO creative_cards (id, article_id, kind, format, svg, svg_sha256, alt_text, width, height, mock, brand_status, criado_por, criado_em) VALUES ('x', 'a', 'story', 'square', '<svg/>', 'z', 'a', 1, 1, false, 'p', 'u', now())`)).rejects.toThrow(/creative_cards_/);
    } finally {
      await t.close();
    }
  }, 120_000);

  it('o down só toca nesta tabela e no registro DESTA migração (created_at = when do journal)', () => {
    expect([...DOWN.matchAll(/DROP TABLE IF EXISTS (\w+);/g)].map((m) => m[1])).toEqual(['creative_cards']);
    const when = JOURNAL.entries.find((e) => e.tag === TAG)!.when;
    expect(DOWN).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${when};`);
    expect(DOWN.replace(/--.*$/gm, '')).not.toMatch(/\bDROP (SCHEMA|DATABASE)\b|TRUNCATE|\bDELETE FROM (?!drizzle\.__drizzle_migrations)/i);
  });
});
