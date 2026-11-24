import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './testing';

// A migração 0028 (openbot_pilot_resolutions) é REVERSÍVEL: o down remove a tabela e o registro da migração sem tocar nas linhas do piloto; o up pode ser aplicado de novo.
const DIR = fileURLToPath(new URL('../drizzle/', import.meta.url));
const UP = readFileSync(`${DIR}0028_openbot_pilot_resolutions.sql`, 'utf8');
const DOWN = readFileSync(`${DIR}down/0028_openbot_pilot_resolutions.down.sql`, 'utf8');
const journal = JSON.parse(readFileSync(`${DIR}meta/_journal.json`, 'utf8')) as { entries: { tag: string; when: number }[] };

describe('migração 0028 openbot_pilot_resolutions: subir, descer e subir de novo', () => {
  it('a tabela existe com a FK para a linha do piloto; o down a remove e tira o registro, sem tocar nas linhas; o up volta a criá-la', async () => {
    const t = await createTestDb();
    try {
      const existe = async () => (await t.client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'openbot_pilot_resolutions'`)).rows.length === 1;
      const registro = async () => Number((await t.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`)).rows[0]!.n);
      expect(await existe()).toBe(true);
      await t.client.query(`INSERT INTO openbot_pilot_rows (task_id, attempt, stage, account, outcome, started_at, row, updated_at) VALUES ('violation-1', 1, 'rights_seo_qa', 'deterministic', 'failed', now(), '{}'::jsonb, now())`);
      // CHECKs e FK: motivo curto, ação vazia e linha inexistente são recusados
      const ins = (task: string, motivo: string, acao: string) => t.client.query(`INSERT INTO openbot_pilot_resolutions (task_id, attempt, resolvido_por, resolvido_em, motivo, acao_tomada) VALUES ($1, 1, 'admin-1', now(), $2, $3)`, [task, motivo, acao]);
      await expect(ins('violation-1', 'curto', 'x')).rejects.toThrow(/openbot_pilot_resolutions_motivo/);
      await expect(ins('violation-1', 'motivo com tamanho suficiente', '  ')).rejects.toThrow(/openbot_pilot_resolutions_acao/);
      await expect(ins('nao-existe', 'motivo com tamanho suficiente', 'x')).rejects.toThrow(/openbot_pilot_resolutions_row_fk/);
      await ins('violation-1', 'motivo com tamanho suficiente', 'segredo_rotacionado');
      await expect(ins('violation-1', 'motivo com tamanho suficiente', 'x')).rejects.toThrow(/openbot_pilot_resolutions_task_id_attempt_pk/);
      const antes = await registro();
      await t.client.exec(DOWN);
      expect(await existe()).toBe(false);
      expect(await registro()).toBe(antes - 1);
      expect((await t.client.query(`SELECT count(*)::int AS n FROM openbot_pilot_rows`)).rows[0]).toMatchObject({ n: 1 }); // a linha do piloto fica
      for (const stmt of UP.split('--> statement-breakpoint')) if (stmt.trim()) await t.client.exec(stmt);
      expect(await existe()).toBe(true);
    } finally {
      await t.close();
    }
  });

  it('o down só toca em openbot_pilot_resolutions e no registro desta migração; é a última entrada do journal na ordem certa', () => {
    expect([...DOWN.matchAll(/DROP TABLE IF EXISTS (\w+);/g)].map((m) => m[1])).toEqual(['openbot_pilot_resolutions']);
    const e = journal.entries.find((x) => x.tag === '0028_openbot_pilot_resolutions')!;
    expect(DOWN).toContain(`created_at = ${e.when};`);
    expect(DOWN.replace(/--.*$/gm, '')).not.toMatch(/\bDROP (SCHEMA|DATABASE)\b|TRUNCATE/i);
    expect(journal.entries.findIndex((x) => x.tag === '0027_crm_contatos_posicoes')).toBeLessThan(journal.entries.indexOf(e));
  });
});
