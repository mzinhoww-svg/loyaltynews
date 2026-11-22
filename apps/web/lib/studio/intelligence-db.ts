// Banco do Entity Intelligence no Studio. Produção: DATABASE_URL (PostgreSQL via pg). Sem DATABASE_URL o Studio NÃO inventa
// dados: só sobe um banco PGlite em memória (vazio, com as migrações oficiais de @ln/db) quando LN_STUDIO_DEV_DB=pglite
// (dev/e2e). Sem nenhum dos dois: indisponível, e as telas mostram estado "banco não configurado".
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Db } from '@ln/intelligence';
import { singleton } from './registros';

export type Origem = 'postgres' | 'pglite-memoria';
export interface BancoIntelligence {
  db: Db;
  origem: Origem;
}

export class BancoIndisponivel extends Error {
  constructor() {
    super('Banco de dados não configurado (defina DATABASE_URL).');
    this.name = 'BancoIndisponivel';
  }
}

function pastaMigracoes(): string {
  const candidatos = [process.env.LN_DB_MIGRATIONS, resolve(process.cwd(), '../../packages/db/drizzle'), resolve(process.cwd(), 'packages/db/drizzle')].filter((x): x is string => Boolean(x));
  const achada = candidatos.find((p) => existsSync(join(p, 'meta', '_journal.json')));
  if (!achada) throw new Error('Migrações de @ln/db não encontradas.');
  return achada;
}

async function criar(): Promise<BancoIntelligence> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return { db: pool as unknown as Db, origem: 'postgres' };
  }
  if (process.env.LN_STUDIO_DEV_DB === 'pglite') {
    const { PGlite } = await import('@electric-sql/pglite');
    const client = new PGlite();
    const pasta = pastaMigracoes();
    const journal = JSON.parse(readFileSync(join(pasta, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    for (const e of journal.entries) await client.exec(readFileSync(join(pasta, `${e.tag}.sql`), 'utf8').replaceAll('--> statement-breakpoint', ''));
    return { db: client as unknown as Db, origem: 'pglite-memoria' };
  }
  throw new BancoIndisponivel();
}

/** Promessa única por processo; falha de configuração não é memorizada (tenta de novo na próxima chamada). */
export async function bancoIntelligence(): Promise<BancoIntelligence> {
  const cache = singleton<{ p?: Promise<BancoIntelligence> }>('intel-db', () => ({}));
  if (!cache.p) {
    cache.p = criar().catch((e) => {
      cache.p = undefined;
      throw e;
    });
  }
  return cache.p;
}

/** Para as telas: devolve o banco ou `null` quando não configurado (estado honesto). */
export async function bancoOuNulo(): Promise<BancoIntelligence | null> {
  try {
    return await bancoIntelligence();
  } catch (e) {
    if (e instanceof BancoIndisponivel) return null;
    throw e;
  }
}
