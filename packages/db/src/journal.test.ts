import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// O drizzle migrate lê o _journal.json e abre CADA arquivo .sql do tag: tag sem arquivo (ou arquivo sem tag) = banco que não migra.
const DIR = fileURLToPath(new URL('../drizzle/', import.meta.url));
const journal = JSON.parse(readFileSync(`${DIR}meta/_journal.json`, 'utf8')) as { entries: { idx: number; tag: string; when: number }[] };

describe('journal das migracoes', () => {
  it('todo tag do journal tem o .sql e o snapshot, e todo .sql tem tag no journal', () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(tags.filter((t) => !existsSync(`${DIR}${t}.sql`)), 'tag sem .sql').toEqual([]);
    expect(tags.filter((t) => !existsSync(`${DIR}meta/${t.split('_')[0]}_snapshot.json`)), 'tag sem snapshot').toEqual([]);
    const sqls = readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4));
    expect(sqls.filter((s) => !tags.includes(s)), '.sql sem tag no journal').toEqual([]);
  });

  it('idx contiguo a partir de 0, numero do tag igual ao idx, e datas estritamente crescentes (o migrador aplica pela data)', () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx, e.tag).toBe(i);
      expect(Number(e.tag.split('_')[0]), e.tag).toBe(i);
    });
    for (let i = 1; i < journal.entries.length; i++) expect(journal.entries[i]!.when, journal.entries[i]!.tag).toBeGreaterThan(journal.entries[i - 1]!.when);
  });

  it('todo script down tem o .sql da mesma migracao', () => {
    const downs = existsSync(`${DIR}down`) ? readdirSync(`${DIR}down`).filter((f) => f.endsWith('.down.sql')) : [];
    for (const d of downs) expect(existsSync(`${DIR}${d.replace('.down.sql', '.sql')}`), d).toBe(true);
  });
});
