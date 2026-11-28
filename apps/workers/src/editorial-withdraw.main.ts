// Comando avulso do operador (não faz parte do main.ts): atende pedido de retirada de conteúdo coletado.
//   APP_ENV=staging DATABASE_URL=... node dist/editorial-withdraw.js --ambiente staging --fonte mestre-das-milhas          (só conta)
//   APP_ENV=staging DATABASE_URL=... node dist/editorial-withdraw.js --ambiente staging --url https://... --confirmar      (apaga)
// Recusa (saída 2) se o banco não for o registrado em infra/vertra/bindings.json para o --ambiente (parecer 105).
// Vale para itens que estão só na caixa de pautas. Matéria já redigida ou publicada se trata pelo fluxo de correção do Studio.
import { drizzle } from 'drizzle-orm/node-postgres';
import { errLine, installOutputFilter, installProcessGuards } from '@ln/db/safe-log';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { createFactoryPool } from './editorial-factory';
import { PgEditorialStore } from './editorial-store';
import { WITHDRAW_USAGE, WithdrawRefused, assertWithdrawEnvironment, parseWithdrawArgs, runWithdraw } from './editorial-withdraw';

installOutputFilter();
installProcessGuards();

async function main() {
  const args = parseWithdrawArgs(process.argv.slice(2));
  if (!args) { console.error(`[retirada] ${WITHDRAW_USAGE}`); process.exit(2); }
  try { assertWithdrawEnvironment(process.env, args.environment); } catch (e) {
    if (!(e instanceof WithdrawRefused)) throw e;
    console.error(`[retirada] ${e.message}`); process.exit(2);
  }
  let pool: ReturnType<typeof createFactoryPool>;
  try { pool = createFactoryPool(process.env, { max: 2 }); } catch (e) { console.error(errLine('[retirada] configuração de TLS do banco inválida', e)); process.exit(1); }
  try {
    const store = new PgEditorialStore(drizzle(pool, { schema }) as unknown as Db);
    console.log(`[retirada] ambiente ${args.environment}: ${await runWithdraw(store, args, new Date())}`);
  } finally {
    await pool.end();
  }
}

void main().catch((e) => { console.error('[retirada] falhou:', e instanceof Error ? e.message : 'erro'); process.exit(1); });
