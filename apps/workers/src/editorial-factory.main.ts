// Execução avulsa da Fábrica editorial (staging). NÃO faz parte do processo de workers (main.ts): é um comando que o operador
// roda quando quiser, com as flags que ele mesmo escolhe. Padrão SEGURO: dry-run (só coleta e relata; sem modelo; sem gravar matéria).
//   DATABASE_URL=... LN_FACTORY_FLAGS=editorialCollector node dist/editorial-factory.js                       (dry-run)
//   DATABASE_URL=... LN_FACTORY_FLAGS=editorialCollector,editorialPipeline node dist/editorial-factory.js --run --simulate
// `--run` desliga o dry-run; `--simulate` usa o cliente SIMULADO do modelops (nenhuma chamada real). Chamada real de modelo
// exige `modelosHabilitados` + política com production_enabled + ledger persistente (ainda inexistente): recusada aqui.
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { BudgetGate, MemoryLedgerStore, SimulatedOpenRouterClient, gateConfigFromPolicy, loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { parseFactoryFlags, runEditorialFactory } from './editorial-factory';

async function main() {
  const { DATABASE_URL, LN_FACTORY_FLAGS, LN_MODEL_POLICY } = process.env;
  const args = process.argv.slice(2);
  const run = args.includes('--run');
  const simulate = args.includes('--simulate');
  const max = Number(args[args.indexOf('--max') + 1]) || undefined;
  if (!DATABASE_URL) { console.error('[fábrica] DATABASE_URL é obrigatório'); process.exit(1); }
  const flags = parseFactoryFlags(LN_FACTORY_FLAGS);
  if (flags.modelosHabilitados) { console.error('[fábrica] modelosHabilitados recusada: ledger de orçamento persistente ainda não existe'); process.exit(1); }
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  pool.on('error', () => undefined); // C1
  const db = drizzle(pool, { schema }) as unknown as Db;
  try {
    let gateway;
    if (run) {
      if (!simulate) { console.error('[fábrica] --run exige --simulate enquanto não houver chamada real de modelo autorizada'); process.exit(1); }
      const path = LN_MODEL_POLICY ?? resolve(process.cwd(), 'packages/modelops/fixtures/model.policy.proposto-DP02-v5.json');
      const check = loadPolicyFile(path);
      if (!check.ok) { console.error('[fábrica] política inválida:', check.errors.join('; ')); process.exit(1); }
      const policy = check.policy as ModelPolicy;
      gateway = {
        deps: { policy, gate: new BudgetGate(gateConfigFromPolicy(policy), new MemoryLedgerStore()), client: new SimulatedOpenRouterClient(), flags },
        mode: 'simulation' as const, qualifiedModelIds: [] as string[], zdrVerifiedModelIds: [] as string[],
      };
    }
    const report = await runEditorialFactory({ db, flags, dryRun: !run, ...(gateway ? { gateway } : {}), ...(max ? { options: { maxArticles: max } } : {}) });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((e) => { console.error('[fábrica] falhou:', e instanceof Error ? e.message : 'erro'); process.exit(1); });
