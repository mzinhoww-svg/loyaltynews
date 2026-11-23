// CLI do orçamento de modelos, SEM agente e SEM a web (R2-14): quem tem acesso ao ambiente (DATABASE_URL + DB_SSL_*_PEM) aciona a parada.
//   node dist/budget-cli.js status
//   node dist/budget-cli.js kill on  "<motivo>" [--route <nome>] --actor <seu-id>
//   node dist/budget-cli.js kill off "<motivo>" [--route <nome>] --actor <seu-id>
//   node dist/budget-cli.js reconcile <AAAA-MM> [--tolerance <pct>]   (G4.2: confere o ledger com /generation do OpenRouter; só leitura; exige OPENROUTER_API_KEY; sai 0 só se o mês FECHA)
// Usa o PostgresLedgerStore de @ln/modelops (tabela `budget_kill_switch`). Build: npm run build:budget-cli -w @ln/workers.
// Nunca imprime URL, senha nem PEM.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from '@ln/db';
import { pgPoolConfig } from '@ln/db/tls';
import { audit } from '@ln/auth';
import type { Db } from '@ln/auth';
import policyRaw from '@ln/modelops/policy';
import { BudgetGate, PostgresLedgerStore, createOpenRouterGenerationReader, describeReconciliation, gateConfigFromPolicy, reconcileMonth, validatePolicy, type SqlDatabase } from '@ln/modelops';

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = console.log,
  /** Só testes: banco já aberto (sem Pool do ambiente). */
  injectedDb?: unknown,
  /** Só testes: fetch da conciliação (padrão: fetch global). */
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const [cmd, sub, motivo, ...rest] = argv;
  const opt = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (cmd !== 'status' && cmd !== 'reconcile' && !(cmd === 'kill' && (sub === 'on' || sub === 'off'))) {
    out('uso: status | kill on|off "<motivo>" [--route <nome>] --actor <id> | reconcile <AAAA-MM> [--tolerance <pct>]');
    return 2;
  }
  if (cmd === 'reconcile') {
    const month = sub;
    const key = env.OPENROUTER_API_KEY?.trim();
    if (!month || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
      out('informe o mês no formato AAAA-MM');
      return 2;
    }
    if (!key) {
      out('conciliação exige OPENROUTER_API_KEY no ambiente (só leitura de /generation)');
      return 2;
    }
    const tol = [sub, motivo, ...rest].includes('--tolerance') ? Number([sub, motivo, ...rest][[sub, motivo, ...rest].indexOf('--tolerance') + 1]) : 1;
    if (!Number.isFinite(tol) || tol < 0 || tol > 5) {
      out('tolerância inválida (0 a 5, em %)');
      return 2;
    }
    const check = validatePolicy(policyRaw);
    if (!check.ok || !check.policy) {
      out('política de modelos inválida');
      return 1;
    }
    const rpool = injectedDb ? null : new Pool(pgPoolConfig(env, { max: 1 }));
    try {
      const rdb = (injectedDb ?? drizzle(rpool!, { schema })) as ReturnType<typeof drizzle<typeof schema>>;
      const gate = new BudgetGate(gateConfigFromPolicy(check.policy), new PostgresLedgerStore(rdb as unknown as SqlDatabase));
      const result = await reconcileMonth(gate, createOpenRouterGenerationReader(key, fetchImpl), month, tol);
      out(describeReconciliation(result));
      for (const u of result.unverified) out(`  sem prova: ${u.reservationId}${u.generationId ? ` (${u.generationId})` : ''} — ${u.reason}`);
      for (const m of result.mismatches) out(`  divergente: ${m.reservationId} (${m.generationId}) ledger ${m.ledgerMicro} × provedor ${m.providerMicro} micro-US$`);
      return result.closed ? 0 : 1;
    } finally {
      await rpool?.end();
    }
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
