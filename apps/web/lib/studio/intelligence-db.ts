// Banco do Entity Intelligence no Studio. Produção: DATABASE_URL (PostgreSQL via pg). Sem DATABASE_URL o Studio NÃO inventa
// dados: o banco PGlite em memória (vazio) só existe no build de e2e e no `next dev`, via alias `@ln-studio/dev-db`, e ainda
// exige LN_STUDIO_DEV_DB=pglite. Em produção essa variável é ignorada (fábrica nula) e o build a recusa.
import { devDb } from '@ln-studio/dev-db';
import { BancoIndisponivel, criarBanco, type BancoIntelligence } from './intelligence-db-core';
import { singleton } from './registros';

export { BancoIndisponivel, type BancoIntelligence } from './intelligence-db-core';

/** Promessa única por processo; falha de configuração não é memorizada (tenta de novo na próxima chamada). */
export async function bancoIntelligence(): Promise<BancoIntelligence> {
  const cache = singleton<{ p?: Promise<BancoIntelligence> }>('intel-db', () => ({}));
  if (!cache.p) {
    cache.p = criarBanco(process.env, devDb).catch((e) => {
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
