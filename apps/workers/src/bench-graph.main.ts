// Ponto de entrada da medição da ADR-009 de dentro da rede (ver bench-graph.ts). Build: npm run build:bench-graph -w @ln/workers.
//   node dist/bench-graph.js --confirm-staging-bench [--scale 0.02] [--with-reference] [--with-indexes] [--replace]
import { Client } from 'pg';
import { pgPoolConfig } from '@ln/db/tls';
import { errLine, installOutputFilter, installProcessGuards } from '@ln/db/safe-log';
import type { BenchHandle } from '@ln/intelligence/bench-pg';
import bindingsFile from '../../../infra/vertra/bindings.json';
import migrationSql from '../../../packages/db/drizzle/0006_intelligence.sql';
import { runBenchGraphCli, type BindingsFile } from './bench-graph';

installOutputFilter(); // nenhum PEM/URL sai na saída, nem em erro
installProcessGuards();

let handle: BenchHandle | undefined;
let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.error(`sinal ${signal}: apagando o schema de teste antes de sair`);
  (handle ? handle.abort() : Promise.resolve()).catch(() => undefined).finally(() => process.exit(130));
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const code = await runBenchGraphCli({
  argv: process.argv.slice(2),
  env: process.env,
  bindings: bindingsFile as BindingsFile,
  migrationSql,
  connect: async (env) => {
    try {
      const { connectionString, ssl } = pgPoolConfig(env, { max: 1 }); // a MESMA configuração de TLS (DB_SSL_*_PEM) do worker
      const client = new Client({ connectionString, ssl });
      await client.connect();
      return { client: { query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows }) }, close: () => client.end() };
    } catch (e) {
      console.error(errLine('[bench-graph] conexão', e));
      throw e;
    }
  },
  out: (l) => console.log(l),
  err: (l) => console.error(l),
  onHandle: (h) => { handle = h; },
});
process.exitCode = code;
