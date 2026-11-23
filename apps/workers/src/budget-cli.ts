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

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = console.log,
  /** Só testes: banco já aberto (sem Pool do ambiente). */
  injectedDb?: unknown,
): Promise<number> {
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
  const pool = injectedDb ? null : new Pool(pgPoolConfig(env, { max: 1 }));
  try {
    const db = (injectedDb ?? drizzle(pool!, { schema })) as ReturnType<typeof drizzle<typeof schema>>;
    const store = new PostgresLedgerStore(db as unknown as SqlDatabase);
    if (cmd === 'kill') {
      const route = opt('--route');
      const scope = route ? (`route:${route}` as const) : 'global';
      const at = new Date();
      // parada e auditoria na MESMA transação (o autor e o histórico ficam no audit_log): se a auditoria falhar, a parada é desfeita
      try {
        await store.setKillWith(scope, sub === 'on', motivo!, at, (tx) =>
          audit(tx as unknown as Db, { actorId: opt('--actor'), actorRole: 'cli', action: sub === 'on' ? 'orcamento.kill_switch_acionado' : 'orcamento.kill_switch_desligado', resource: 'orcamento', resourceId: scope, detalhe: { escopo: scope, motivo, via: 'cli' }, at }),
        );
      } catch (e) {
        out(`A parada NÃO foi alterada: a auditoria falhou e a operação foi desfeita (${e instanceof Error ? e.message : 'erro'}).`);
        return 1;
      }
    }
    out(JSON.stringify(await store.readKill()));
    return 0;
  } finally {
    await pool?.end();
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
