// Execução avulsa da Fábrica editorial (staging). NÃO faz parte do processo de workers (main.ts): é um comando que o operador
// roda quando quiser, com as flags que ele mesmo escolhe. Padrão SEGURO: dry-run (só coleta e relata; sem modelo; sem gravar matéria).
//   DATABASE_URL=... LN_FACTORY_FLAGS=editorialCollector node dist/editorial-factory.js                       (dry-run)
//   DATABASE_URL=... LN_FACTORY_FLAGS=editorialCollector,editorialPipeline node dist/editorial-factory.js --run --simulate
// `--run` desliga o dry-run; `--simulate` usa o cliente SIMULADO do modelops (nenhuma chamada real). Chamada real de modelo
// exige `modelosHabilitados` + política com production_enabled + ledger persistente (ainda inexistente): recusada aqui.
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { errLine, installOutputFilter, installProcessGuards } from '@ln/db/safe-log';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { BudgetGate, MemoryLedgerStore, SimulatedOpenRouterClient, gateConfigFromPolicy, loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { TavilyReader, parseTavilyKeys } from '@ln/editorial';
import { pilotWiringImporter } from './openbot-wiring';
import { createFactoryPool, loadPilotWiring, loadShadow, parseFactoryFlags, runEditorialAutoral, runEditorialFactory, runEditorialReprocess, ReprocessRefused, REPROCESS_STAGES } from './editorial-factory';

// Nenhum erro de conexão pode sair com o objeto inteiro (ca/cert/key do TLS): filtro de PEM na saída e saída com código ≠ 0 em erro não tratado.
installOutputFilter();
installProcessGuards();

async function main() {
  const { DATABASE_URL, LN_FACTORY_FLAGS, LN_MODEL_POLICY } = process.env;
  const args = process.argv.slice(2);
  const run = args.includes('--run');
  const simulate = args.includes('--simulate');
  const max = Number(args[args.indexOf('--max') + 1]) || undefined;
  const argOf = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const reprocess = argOf('--reprocess');
  if (!DATABASE_URL) { console.error('[fábrica] DATABASE_URL é obrigatório'); process.exit(1); }
  const flags = parseFactoryFlags(LN_FACTORY_FLAGS);
  if (flags.modelosHabilitados) { console.error('[fábrica] modelosHabilitados recusada: ledger de orçamento persistente ainda não existe'); process.exit(1); }
  let pool: ReturnType<typeof createFactoryPool>;
  try { pool = createFactoryPool(process.env, { max: 4 }); } catch (e) { console.error(errLine('[fábrica] configuração de TLS do banco inválida', e)); process.exit(1); }
  const db = drizzle(pool, { schema }) as unknown as Db;
  try {
    const pilot = await loadPilotWiring(process.env, pilotWiringImporter(db)); // importador ESTÁTICO (o main é empacotado por esbuild); DP-41: só staging (APP_ENV=staging e LN_OPENBOT_PILOT=1); senão undefined
    let gateway;
    if (run && !pilot) {
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
    // DP-31 (desligado por padrão): só com LN_TAVILY_API_KEYS (lista ordenada, separada por vírgula; troca de chave só quando a COTA acaba) ou LN_TAVILY_API_KEY.
    // Os valores vêm do cofre do OpenBot pelo operador e NUNCA são impressos nem gravados.
    const shadow = await loadShadow(process.env);
    const tavilyKeys = parseTavilyKeys(process.env);
    const reader = tavilyKeys.length ? new TavilyReader({ apiKeys: tavilyKeys }) : undefined;
    if (reprocess) {
      // F (aprovado pelo PM em 26/11): reprocessa UMA etapa de UMA matéria já gravada, com operador e motivo na trilha.
      if (!run) { console.error('[fábrica] --reprocess exige --run (é uma ação de operador, não dry-run)'); process.exit(1); }
      if (!gateway && !pilot) { console.error('[fábrica] --reprocess chama modelo: use --run --simulate ou o piloto do OpenBot'); process.exit(1); }
      const stage = argOf('--stage');
      if (!stage || !REPROCESS_STAGES.includes(stage as never)) { console.error(`[fábrica] --stage obrigatório: ${REPROCESS_STAGES.join('|')}`); process.exit(1); }
      try {
        const report = await runEditorialReprocess({
          db, flags, articleId: reprocess, stage: stage as never,
          motivo: argOf('--motivo') ?? '', operatorId: argOf('--operator') ?? '',
          ...(pilot ? { modelGateway: pilot.gateway, pilotSink: pilot.sink } : {}),
          ...(gateway ? { gateway } : {}),
        });
        console.log(JSON.stringify(report, null, 2));
      } catch (e) {
        if (e instanceof ReprocessRefused) { console.error(`[fábrica] reprocessamento recusado (${e.code}): ${e.message}`); process.exit(2); }
        throw e;
      }
      return;
    }
    if (args.includes('--autoral')) {
      // pautas autorais pendentes (DP-29): exige --run --simulate enquanto não houver chamada real de modelo autorizada
      if (!gateway && !pilot) { console.error('[fábrica] --autoral chama modelo: use --run --simulate'); process.exit(1); }
      console.log(JSON.stringify(await runEditorialAutoral({ db, flags, ...(gateway ? { gateway } : {}), ...(pilot ? { modelGateway: pilot.gateway, pilotSink: pilot.sink } : {}), ...(reader ? { reader } : {}), ...(shadow ? { shadow } : {}), ...(max ? { max } : {}) }), null, 2));
      return;
    }
    const report = await runEditorialFactory({ db, flags, dryRun: !run, ...(pilot ? { modelGateway: pilot.gateway, pilotSink: pilot.sink } : {}), ...(reader ? { reader } : {}), ...(shadow ? { shadow } : {}), ...(gateway ? { gateway } : {}), ...(max ? { options: { maxArticles: max } } : {}) });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((e) => { console.error('[fábrica] falhou:', e instanceof Error ? e.message : 'erro'); process.exit(1); });
