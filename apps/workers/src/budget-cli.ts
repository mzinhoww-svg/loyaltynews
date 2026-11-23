// CLI do orçamento de modelos, SEM agente e SEM a web (R2-14): quem tem acesso ao ambiente (DATABASE_URL + DB_SSL_*_PEM) aciona a parada.
//   node dist/budget-cli.js status
//   node dist/budget-cli.js kill on  "<motivo>" [--route <nome>] --actor <seu-id>
//   node dist/budget-cli.js kill off "<motivo>" [--route <nome>] --actor <seu-id>
// Usa o PostgresLedgerStore de @ln/modelops (tabela `budget_kill_switch`). Build: npm run build:budget-cli -w @ln/workers.
// Nunca imprime URL, senha nem PEM.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from '@ln/db';
import { pgPoolConfig } from '@ln/db/tls';
import { audit } from '@ln/auth';
import type { Db } from '@ln/auth';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';

export async function run(argv: string[], env: Record<string, string | undefined> = process.env, out: (s: string) => void = console.log): Promise<number> {
  const [cmd, sub, motivo, ...rest] = argv;
  const opt = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (cmd !== 'status' && !(cmd === 'kill' && (sub === 'on' || sub === 'off'))) {
    out('uso: status | kill on|off "<motivo>" [--route <nome>] --actor <id>');
    return 2;
  }
  if (cmd === 'kill' && (!opt('--actor') || !motivo || motivo.trim().length < 5)) {
    out('informe o motivo (mínimo 5 caracteres) e --actor <seu id>');
    return 2;
  }
  const pool = new Pool(pgPoolConfig(env, { max: 1 }));
  try {
    const db = drizzle(pool, { schema });
    const store = new PostgresLedgerStore(db as unknown as SqlDatabase);
    if (cmd === 'kill') {
      const route = opt('--route');
      const scope = route ? (`route:${route}` as const) : 'global';
      const at = new Date();
      await store.setKill(scope, sub === 'on', motivo!, at);
      // o autor e o histórico ficam no audit_log (append-only); a tabela da parada guarda só o estado vigente
      await audit(db as unknown as Db, { actorId: opt('--actor'), actorRole: 'cli', action: sub === 'on' ? 'orcamento.kill_switch_acionado' : 'orcamento.kill_switch_desligado', resource: 'orcamento', resourceId: scope, detalhe: { escopo: scope, motivo, via: 'cli' }, at });
    }
    out(JSON.stringify(await store.readKill()));
    return 0;
  } finally {
    await pool.end();
  }
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] !== undefined && /budget-cli\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`falha: ${e instanceof Error ? e.message : 'erro'}`); // só a mensagem
      process.exit(1);
    },
  );
}
