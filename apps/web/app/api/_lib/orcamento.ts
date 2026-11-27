// Orçamento de modelos no Studio (DP-04, ADR-015, ADR-020): leitura do mês e kill switch, acionável por PESSOA com MFA (sem agente).
// ÚNICO ledger: as tabelas `budget_*` de @ln/db, escritas só pelo `PostgresLedgerStore` de @ln/modelops (uma transação com
// `pg_advisory_xact_lock` por operação do BudgetGate). Nada de tabela de eventos paralela.
import { z } from 'zod';
import { desc, like, sql } from 'drizzle-orm';
import { audit, sanitizeAuditRow } from '@ln/auth';
import { BudgetGate, PostgresLedgerStore, gateConfigFromPolicy, microToUsd, monthKey, validatePolicy, type GateConfig, type SqlDatabase } from '@ln/modelops';
import policyRaw from '@ln/modelops/policy';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { HttpError, json, readBody, type RouteFn } from './http';

let cfg: GateConfig | null = null;
/** Configuração do portão a partir da política validada (DP-02 v5: teto, verbas por provedor e degraus). */
export function budgetConfig(): GateConfig {
  if (cfg) return cfg;
  const check = validatePolicy(policyRaw);
  if (!check.ok || !check.policy) throw new Error(`política de modelos inválida: ${check.errors.slice(0, 3).join('; ')}`);
  cfg = gateConfigFromPolicy(check.policy);
  return cfg;
}

/** Loja do ledger persistente (única porta de escrita do orçamento). */
export const budgetStore = (db: Db): PostgresLedgerStore => new PostgresLedgerStore(db as unknown as SqlDatabase);

/** Portão de orçamento persistente: o MESMO ledger para web, workers e qualquer instância. */
export const budgetGate = (db: Db): BudgetGate => new BudgetGate(budgetConfig(), budgetStore(db));

/** Parada vigente no formato do roteador. O gateway já lê a parada do banco sozinho; isto serve a telas e a quem monta a chamada. */
export async function killFlags(db: Db): Promise<{ killGlobal: boolean; killedRoutes: string[] }> {
  const k = await budgetStore(db).readKill();
  return { killGlobal: k.global, killedRoutes: k.routes };
}

/** Estado detalhado da parada (por quê, quando) de `budget_kill_switch`; quem acionou vem do audit_log (a tabela canônica não guarda o autor). */
export async function killDetail(db: Db) {
  const rows = await db.select().from(schema.budgetKillSwitch);
  const logs = await db
    .select({ scope: schema.auditLog.resourceId, actor: schema.auditLog.actorId, at: schema.auditLog.at })
    .from(schema.auditLog)
    .where(like(schema.auditLog.action, 'orcamento.kill_switch%'))
    .orderBy(desc(schema.auditLog.at));
  // o autor vem do audit_log: passa pela mesma barreira da escrita (linha antiga pode ter e-mail como ator)
  const actorOf = (scope: string) => sanitizeAuditRow({ action: 'orcamento', resource: 'orcamento', actorId: logs.find((l) => l.scope === scope)?.actor }).actorId;
  const g = rows.find((r) => r.scope === 'global');
  return {
    global: { engaged: g?.active ?? false, reason: g?.reason ?? null, at: g?.at.toISOString() ?? null, actor: g ? actorOf('global') : null },
    routes: rows
      .filter((r) => r.scope.startsWith('route:') && r.active)
      .map((r) => ({ route: r.scope.slice('route:'.length), reason: r.reason, at: r.at.toISOString(), actor: actorOf(r.scope) }))
      .sort((a, b) => a.route.localeCompare(b.route)),
  };
}

const usd = (micro: number) => microToUsd(micro);

/** GET: gasto do mês, por provedor, reserva, escalonamento, abertas/pendentes, degraus, taxas de recarga e kill switch. */
export const getBudget: RouteFn = async (_req, c) => {
  const db = c.deps.db;
  const config = budgetConfig();
  const now = c.deps.now();
  const snap = await budgetGate(db).snapshot(now);
  const fees = (await db.execute(sql`SELECT COALESCE(SUM(amount_microusd), 0)::bigint AS total FROM budget_refill_fees WHERE month_key = ${monthKey(now)}`)) as unknown as { rows: { total: string | number }[] };
  return json({
    data: {
      mes: snap.monthKey,
      tetoUsd: usd(config.capMicro),
      gastoUsd: usd(snap.totalMicro),
      restanteUsd: usd(config.capMicro - snap.totalMicro),
      verbaUsd: usd(snap.allocationMicro),
      reservaAuditoriaUsd: { usado: usd(snap.reserveMicro), limite: usd(config.reserveMicro) },
      escalonamentoUsd: { usado: usd(snap.escalationMicro), limite: usd(config.escalationSublimitMicro) },
      porProvedorUsd: Object.fromEntries(
        Object.entries(config.providerAllocationMicro).map(([p, lim]) => [p, { usado: usd(snap.providerMicro[p] ?? 0), limite: usd(lim) }]),
      ),
      degrausUsd: { premium: usd(config.ceilingMicro.premium), naoEssencial: usd(config.ceilingMicro.non_essential), essencial: usd(config.ceilingMicro.essential), reserva: usd(config.ceilingMicro.reserve) },
      reservasAbertas: snap.openReservations,
      reservasPendentes: snap.pendingReservations,
      taxasDeRecargaUsd: usd(Number(fees.rows[0]?.total ?? 0)), // fora do teto (DP-11/P3)
      killSwitch: await killDetail(db),
    },
  });
};

const KillBody = z.strictObject({
  escopo: z.union([z.literal('global'), z.string().regex(/^route:[a-z0-9_]{1,40}$/)]).default('global'),
  acionar: z.boolean(),
  motivo: z.string().trim().min(5).max(500),
});

/** POST: aciona ou desliga a parada (global ou por rota). Só admin (orcamento:update) com MFA; motivo obrigatório; o autor e o histórico ficam no audit_log (append-only). */
export const postKillSwitch: RouteFn = async (req, c) => {
  const b = await readBody(req, KillBody);
  const session = c.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  const now = c.deps.now();
  try {
    // parada e auditoria na MESMA transação, sob a trava do ledger: se a auditoria falhar, a parada NÃO muda
    await budgetStore(c.deps.db).setKillWith(b.escopo as 'global' | `route:${string}`, b.acionar, b.motivo, now, (tx) =>
      audit(tx as unknown as Db, {
        actorId: session.userId, actorRole: session.role, action: b.acionar ? 'orcamento.kill_switch_acionado' : 'orcamento.kill_switch_desligado',
        resource: 'orcamento', resourceId: b.escopo, ip: c.ip, detalhe: { escopo: b.escopo, motivo: b.motivo }, at: now,
      }),
    );
  } catch (e) {
    console.error(`[orcamento] kill switch NÃO aplicado: ${e instanceof Error ? e.message : 'erro'}`); // sem segredo
    throw new HttpError(500, 'KILL_SWITCH_NOT_APPLIED', 'A parada NÃO foi alterada: o registro de auditoria falhou e a operação foi desfeita. Tente de novo.');
  }
  return json({ data: await killDetail(c.deps.db) });
};
