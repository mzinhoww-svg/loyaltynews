// Migração 0030: o backfill do `descartado_em` NÃO pode usar a criação (anteciparia o prazo da DP-55).
// O relógio da retenção começa na migração; um lead criado há 2 anos e descartado ontem só sai 30 dias depois dela.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './testing';

const DIR = fileURLToPath(new URL('../drizzle/', import.meta.url));
const TAG = readdirSync(DIR).find((f) => /^\d{4}_.*\.sql$/.test(f) && f.endsWith('_aromatic_ben_parker.sql'))!.replace(/\.sql$/, '');
const SQL = readFileSync(`${DIR}${TAG}.sql`, 'utf8');
const BACKFILL = SQL.split('--> statement-breakpoint').map((s) => s.trim()).find((s) => /SET\s+"descartado_em"/i.test(s))!;

describe(`migração ${TAG}: backfill do lead descartado`, () => {
  it('o backfill usa now(), nunca criado_em', () => {
    expect(BACKFILL).toMatch(/UPDATE\s+"crm_leads"\s+SET\s+"descartado_em"\s*=\s*now\(\)/i);
    expect(BACKFILL).not.toMatch(/criado_em/i);
    expect(BACKFILL).toMatch(/WHERE\s+"status"\s*=\s*'descartado'/i);
  });

  it('aplicado num banco com lead antigo descartado: o relógio começa agora e ele não sai em 29/30 dias, só em 31', async () => {
    const t = await createTestDb();
    try {
      const db = t.client;
      const doisAnosAtras = new Date(Date.now() - 730 * 86_400_000).toISOString();
      await db.query(
        `INSERT INTO crm_leads (id, nome, empresa, email, objetivo, consentimento_em, status, criado_em)
         VALUES ('legado', 'Pessoa Legado', 'Empresa', 'legado@example.invalid', 'awareness', $1, 'descartado', $1),
                ('novo', 'Pessoa Nova', 'Empresa', 'novo@example.invalid', 'awareness', $1, 'novo', $1)`,
        [doisAnosAtras],
      );
      await db.exec(BACKFILL);

      const legado = (await db.query<{ d: Date | null }>(`SELECT descartado_em AS d FROM crm_leads WHERE id = 'legado'`)).rows[0]!.d;
      const novo = (await db.query<{ d: Date | null }>(`SELECT descartado_em AS d FROM crm_leads WHERE id = 'novo'`)).rows[0]!.d;
      expect(legado).not.toBeNull();
      expect(Math.abs(new Date(legado!).getTime() - Date.now())).toBeLessThan(60_000); // agora, não a criação
      expect(novo).toBeNull(); // não descartado não entra no relógio

      // a condição da retenção (mais antigo que o corte): rodada em base+29/30/31 dias, retenção de 30
      const base = new Date(legado!);
      const devidos = async (dias: number) => Number((await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM crm_leads WHERE status = 'descartado' AND descartado_em IS NOT NULL AND descartado_em < $1`,
        [new Date(base.getTime() + (dias - 30) * 86_400_000).toISOString()],
      )).rows[0]!.n);
      expect(await devidos(29)).toBe(0);
      expect(await devidos(30)).toBe(0);
      expect(await devidos(31)).toBe(1);
    } finally {
      await t.close();
    }
  }, 120_000);
});
