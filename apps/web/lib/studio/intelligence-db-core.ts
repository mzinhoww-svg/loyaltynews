// Núcleo (puro e testável) do banco do Entity Intelligence. NÃO contém código de banco em memória: a fábrica de dev/e2e
// é injetada pelo chamador e só existe no build de e2e e no `next dev` (alias em next.config.ts). Em produção a fábrica é
// nula: LN_STUDIO_DEV_DB é ignorada e o build recusa a variável.
import { pgPoolConfig } from '@ln/db/tls';
import type { Db } from '@ln/intelligence';

export type Origem = 'postgres' | 'pglite-memoria';
export interface BancoIntelligence {
  db: Db;
  origem: Origem;
}
export type FabricaDev = () => Promise<BancoIntelligence>;

export class BancoIndisponivel extends Error {
  constructor() {
    super('Banco de dados não configurado (defina DATABASE_URL).');
    this.name = 'BancoIndisponivel';
  }
}

/** Ordem: DATABASE_URL (PostgreSQL); depois, só se a fábrica de dev existir E LN_STUDIO_DEV_DB=pglite; senão indisponível. */
export async function criarBanco(env: Record<string, string | undefined>, fabricaDev: FabricaDev | null): Promise<BancoIntelligence> {
  if (env.DATABASE_URL) {
    const { Pool } = await import('pg');
    // Vertra exige TLS com certificado de cliente em todo PostgreSQL: a mesma configuração do auth e do worker (@ln/db/tls)
    const pool = new Pool(pgPoolConfig(env, { max: 5 }));
    return { db: pool as unknown as Db, origem: 'postgres' };
  }
  if (fabricaDev && env.LN_STUDIO_DEV_DB === 'pglite') return fabricaDev();
  throw new BancoIndisponivel();
}
