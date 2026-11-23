// Estado REAL de agentes, ModelOps e OpenBot para o Studio (só leitura). Nada aqui é simulado:
//  - o que é CONFIGURAÇÃO versionada (64 perfis, workflows, rituais, política de modelos) sai dos registros validados e diz de onde vem;
//  - o que é ESTADO (execuções de ritual, fila e custos do OpenBot, parada, consumo do mês) sai do PostgreSQL; sem banco, as rotas
//    respondem 503 (nunca um zero inventado).
// Acesso: admin e editor-chefe (`orcamento:read`, a mesma permissão do FinOps).
import { count, max } from 'drizzle-orm';
import { buildOrganization, loadRegistries } from '@ln/agents';
import { isEnabled } from '@ln/contracts';
import { schema } from '@ln/db';
import { monthKey, validatePolicy } from '@ln/modelops';
import policyRaw from '@ln/modelops/policy';
import { PgCostLedger, PgHealthStore, PgLeaseQueue } from '@ln/workers/openbot-pg';
import { budgetConfig, budgetGate, killDetail } from './orcamento';
import { budgetStatus, evaluateHealth, MONTHLY_CAP_MICRO } from '@ln/openbot';
import { HttpError, json, type RouteFn } from './http';

/** Agentes: organização (config) + execuções de ritual (PostgreSQL) + adaptador OpenBot (PostgreSQL). */
export const getAgentesEstado: RouteFn = async (_req, c) => {
  const now = c.deps.now();
  const org = buildOrganization(loadRegistries());
  const perfis = org.registries.agents;
  const porDepartamento = new Map<string, { total: number; habilitados: number }>();
  for (const a of perfis) {
    const d = porDepartamento.get(a.department) ?? { total: 0, habilitados: 0 };
    d.total += 1;
    if (a.enabled) d.habilitados += 1;
    porDepartamento.set(a.department, d);
  }
  const db = c.deps.db;
  const [[runs], [decisoes], [itens], [memoria], [ultima], porStatus] = await Promise.all([
    db.select({ n: count() }).from(schema.meetingRuns),
    db.select({ n: count() }).from(schema.meetingDecisions),
    db.select({ n: count() }).from(schema.actionItems),
    db.select({ n: count() }).from(schema.sectorMemory),
    db.select({ at: max(schema.meetingRuns.executedAt) }).from(schema.meetingRuns),
    db.select({ status: schema.meetingRuns.status, n: count() }).from(schema.meetingRuns).groupBy(schema.meetingRuns.status),
  ]);
  const health = await evaluateHealth(new PgHealthStore(db), now);
  const k = await killDetail(db);
  const openbotKill = k.global.engaged || k.routes.some((r) => r.route === 'openbot');
  const queue = await new PgLeaseQueue(db).counts();
  const ledger = new PgCostLedger(db, c.deps.now);
  const total = await ledger.totalMicro();
  const b = budgetStatus(total, MONTHLY_CAP_MICRO);
  return json({
    data: {
      organizacao: {
        origem: 'registros versionados validados por @ln/agents (configuração, não execução)',
        perfis: perfis.length,
        perfisHabilitados: perfis.filter((a) => a.enabled).length,
        workflows: org.registries.workflows.length,
        rituais: org.registries.meetings.length,
        versaoRituais: org.registries.meetingsVersion,
        redacoes: org.newsrooms.length,
        diretorias: org.directorates.length,
        porDepartamento: [...porDepartamento.entries()].map(([departamento, v]) => ({ departamento, ...v })).sort((a, z) => a.departamento.localeCompare(z.departamento)),
      },
      execucao: {
        origem: 'PostgreSQL (meeting_runs, meeting_decisions, action_items, sector_memory)',
        flagRituais: isEnabled('rituais', c.deps.flags),
        reunioesExecutadas: runs?.n ?? 0,
        porStatus: porStatus.map((s) => ({ status: s.status, total: s.n })),
        ultimaExecucaoEm: ultima?.at ?? null,
        decisoes: decisoes?.n ?? 0,
        itensDeAcao: itens?.n ?? 0,
        memoriaSetorial: memoria?.n ?? 0,
      },
      openbot: {
        origem: 'PostgreSQL (openbot_tasks, openbot_cost_entries, openbot_health)',
        despachoLigado: c.deps.flags.openbotDispatch === true,
        parada: openbotKill,
        saude: health,
        fila: queue,
        custoDoMes: { mes: monthKey(now), totalMicro: total, tetoMicro: MONTHLY_CAP_MICRO, situacao: b.status, restanteMicro: b.remainingMicro },
      },
    },
  });
};

type Modelo = { id: string; provider: string; excluded_by?: string; binding?: { openrouter_id?: string; price_as_of?: string } };

/** ModelOps: política carregada (config), flags e parada (estado) e consumo do mês no ledger canônico (estado). */
export const getModelopsEstado: RouteFn = async (_req, c) => {
  const check = validatePolicy(policyRaw);
  if (!check.ok || !check.policy) throw new HttpError(500, 'POLICY_INVALID', 'A política de modelos carregada é inválida.');
  const p = check.policy;
  const now = c.deps.now();
  const gate = budgetGate(c.deps.db);
  const [snap, kill] = await Promise.all([gate.snapshot(now), killDetail(c.deps.db)]);
  const cfg = budgetConfig();
  const qm = p.qualification?.mode;
  return json({
    data: {
      politica: {
        origem: '@ln/modelops/policy (arquivo da política carregado e validado; a aprovação em vigor é decisão do proprietário e não consta do arquivo)',
        versao: p.version,
        tabelaDePrecosEm: p.rate_card_as_of,
        producaoHabilitada: p.rules.production_enabled,
        tetoMensalUsd: p.rules.hard_monthly_budget_usd,
        modelos: (p.models as unknown as Modelo[]).map((m) => ({ id: m.id, provedor: m.provider, excluidoPor: m.excluded_by ?? null, rotaOpenRouter: m.binding?.openrouter_id ?? null, precoEm: m.binding?.price_as_of ?? null })),
        rotas: p.routes,
        roteamentoPorTarefa: p.routing_by_task,
        qualificacao: qm
          ? { ligada: qm.enabled === true, candidatos: qm.candidates, tetoUsd: qm.cap_usd ?? null, tetoPorEtapaUsd: qm.stage_caps_usd ?? null }
          : null,
      },
      flags: { modelosHabilitados: isEnabled('modelosHabilitados', c.deps.flags), openbotDispatch: c.deps.flags.openbotDispatch === true },
      parada: kill,
      consumo: {
        origem: 'PostgreSQL (ledger canônico budget_*)',
        mes: snap.monthKey,
        totalMicro: snap.totalMicro,
        tetoMicro: cfg.capMicro,
        verbaPorProvedorMicro: cfg.providerAllocationMicro,
        gastoPorProvedorMicro: snap.providerMicro,
        reservaDeAuditoriaMicro: { teto: cfg.reserveMicro, gasto: snap.reserveMicro },
        qualificacaoMicro: snap.qualificationMicro,
        reservasAbertas: snap.openReservations,
        reservasPendentes: snap.pendingReservations,
      },
    },
  });
};
