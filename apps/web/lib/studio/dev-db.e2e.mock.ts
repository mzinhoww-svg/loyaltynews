// MOCK — banco PGlite em memória (vazio, com as migrações oficiais de @ln/db). Só entra no build de e2e (LN_E2E_BUILD=1)
// e no `next dev`; o build de produção nunca o inclui (scripts/verify-no-mock.mjs prova). Ainda exige LN_STUDIO_DEV_DB=pglite.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Db } from '@ln/intelligence';
import type { FabricaDev } from './intelligence-db-core';

function pastaMigracoes(): string {
  const candidatos = [process.env.LN_DB_MIGRATIONS, resolve(process.cwd(), '../../packages/db/drizzle'), resolve(process.cwd(), 'packages/db/drizzle')].filter((x): x is string => Boolean(x));
  const achada = candidatos.find((p) => existsSync(join(p, 'meta', '_journal.json')));
  if (!achada) throw new Error('Migrações de @ln/db não encontradas.');
  return achada;
}

export const devDb: FabricaDev | null = async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const client = new PGlite();
  const pasta = pastaMigracoes();
  const journal = JSON.parse(readFileSync(join(pasta, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  for (const e of journal.entries) await client.exec(readFileSync(join(pasta, `${e.tag}.sql`), 'utf8').replaceAll('--> statement-breakpoint', ''));
  return { db: client as unknown as Db, origem: 'pglite-memoria' };
};
