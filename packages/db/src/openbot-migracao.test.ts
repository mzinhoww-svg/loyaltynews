import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './testing';

// A migração 0022 (openbot_*) é REVERSÍVEL: o script `down` remove as tabelas e o registro da migração, e o `up` pode ser aplicado de novo.
const DIR = fileURLToPath(new URL('../drizzle/', import.meta.url));
const UP = readFileSync(`${DIR}0022_openbot_fila_custos.sql`, 'utf8');
const DOWN = readFileSync(`${DIR}down/0022_openbot_fila_custos.down.sql`, 'utf8');
const TABELAS = ['openbot_callbacks', 'openbot_cost_entries', 'openbot_health', 'openbot_io', 'openbot_pilot_rows', 'openbot_pilot_state', 'openbot_tasks'];
// a 0028 (openbot_pilot_resolutions) depende de openbot_pilot_rows por FK: sobe depois da 0022 e tem de descer ANTES dela
const DOWN_0028 = readFileSync(`${DIR}down/0028_openbot_pilot_resolutions.down.sql`, 'utf8');

describe('migração 0022 openbot_*: subir, descer e subir de novo', () => {
  it('as 7 tabelas existem; o down as remove e tira o registro da migração; o up volta a criá-las', async () => {
    const t = await createTestDb();
    try {
      const existem = async () => (await t.client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'openbot\\_%' ORDER BY 1`)).rows.map((r) => r.table_name);
      expect(await existem()).toEqual([...TABELAS, 'openbot_pilot_resolutions'].sort());
      const registro = async () => Number((await t.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`)).rows[0]!.n);
      const antes = await registro();
      await t.client.exec(DOWN_0028);
      await t.client.exec(DOWN);
      expect(await existem()).toEqual([]);
      expect(await registro()).toBe(antes - 2); // os registros da 0028 e da 0022 saíram: o migrador as aplicaria de novo
      for (const stmt of UP.split('--> statement-breakpoint')) if (stmt.trim()) await t.client.exec(stmt);
      expect(await existem()).toEqual(TABELAS);
    } finally {
      await t.close();
    }
  });

  it('o down não toca em nenhuma outra tabela (só openbot_* e o registro desta migração)', () => {
    const alvos = [...DOWN.matchAll(/DROP TABLE IF EXISTS (\w+);/g)].map((m) => m[1]);
    expect(alvos.sort()).toEqual([...TABELAS].sort());
    expect(DOWN).toMatch(/DELETE FROM drizzle\.__drizzle_migrations WHERE created_at = \d+;/);
    expect(DOWN.replace(/--.*$/gm, '')).not.toMatch(/\bDROP (SCHEMA|DATABASE)\b|TRUNCATE/i);
  });
});
