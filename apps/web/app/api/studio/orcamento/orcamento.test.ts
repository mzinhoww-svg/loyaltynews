/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { callModel, type GatewayCall, SimulatedOpenRouterClient, validatePolicy } from '@ln/modelops';
import policyRaw from '@ln/modelops/policy';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import { budgetConfig, budgetGate, killFlags } from '../../_lib/orcamento';
import * as orcamento from './route';
import * as kill from './kill-switch/route';

// Orçamento de modelos no Studio: leitura do mês e kill switch persistido (só admin, com MFA, motivo obrigatório, auditado).
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let chefe: Actor;
let editor: Actor;
let leitor: Actor;

const get = (as: Actor | null) => call(orcamento.GET, 'GET', { path: '/api/studio/orcamento', as });
const post = (body: unknown, as: Actor | null) => call(kill.POST, 'POST', { path: '/api/studio/orcamento/kill-switch', body, as });
const reserve = (amountUsd: number, over: Record<string, unknown> = {}) =>
  budgetGate(app.db).reserve({
    taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'anthropic/claude-sonnet-5.5', escalation: false, amountUsd, at: app.clock.now, ...over,
  } as any);

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor, leitor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'), await app.actor('leitor')];
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('GET /api/studio/orcamento', () => {
  it('acesso: sem sessão 401; só senha MFA_REQUIRED; editor e leitor 403; admin e editor-chefe leem', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(await app.passwordOnly('admin'))).body.error.code).toBe('MFA_REQUIRED');
    expect((await get(editor)).status).toBe(403);
    expect((await get(leitor)).status).toBe(403);
    expect((await get(admin)).status).toBe(200);
    expect((await get(chefe)).status).toBe(200);
  });

  it('mês zerado: teto 50, verbas, reserva 8, escalonamento 5, degraus 35/40/42/50 e kill switch desligado', async () => {
    const r = await get(admin);
    expect(r.body.data).toMatchObject({
      mes: '2026-11', tetoUsd: 50, gastoUsd: 0, restanteUsd: 50, reservasAbertas: 0, reservasPendentes: 0,
      reservaAuditoriaUsd: { usado: 0, limite: 8 }, escalonamentoUsd: { usado: 0, limite: 5 },
      porProvedorUsd: { openai: { usado: 0, limite: 20 }, anthropic: { usado: 0, limite: 22 }, deepseek: { usado: 0, limite: 0 } },
      degrausUsd: { premium: 35, naoEssencial: 40, essencial: 42, reserva: 50 },
      taxasDeRecargaUsd: 0, killSwitch: { global: { engaged: false }, routes: [] },
    });
    expect(budgetConfig().capMicro).toBe(50_000_000);
  });

  it('reflete o ledger persistido: reserva aberta e pendente contam; comprometido vale o custo real', async () => {
    const a = await reserve(10);
    const b = await reserve(4);
    expect(a.ok && b.ok).toBe(true);
    await budgetGate(app.db).markPending((b as any).reservationId, 'timeout', app.clock.now);
    await budgetGate(app.db).commit((a as any).reservationId, 6.5, app.clock.now);
    const r = (await get(admin)).body.data;
    expect(r).toMatchObject({ gastoUsd: 10.5, restanteUsd: 39.5, reservasAbertas: 0, reservasPendentes: 1 });
    expect(r.porProvedorUsd.anthropic.usado).toBe(10.5);
    expect(await app.db.$count(schema.budgetReservations)).toBe(2); // duas reservas (uma conciliada, uma pendente)
  });
});

describe('POST /api/studio/orcamento/kill-switch', () => {
  it('só admin (orcamento:update); editor-chefe, editor e leitor 403; sem sessão 401; só senha MFA_REQUIRED; nada gravado', async () => {
    const body = { acionar: true, motivo: 'teste de acesso ao kill switch' };
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, await app.passwordOnly('admin'))).body.error.code).toBe('MFA_REQUIRED');
    for (const as of [chefe, editor, leitor]) expect((await post(body, as)).status).toBe(403);
    expect(await app.db.$count(schema.budgetKillSwitch)).toBe(0);
  });

  it('entrada estrita: motivo obrigatório (≥ 5), escopo só global ou route:<nome>, campo extra recusado', async () => {
    for (const bad of [{ acionar: true }, { acionar: true, motivo: 'abc' }, { acionar: 'sim', motivo: 'motivo valido' }, { acionar: true, motivo: 'motivo valido', escopo: 'tudo' }, { acionar: true, motivo: 'motivo valido', extra: 1 }, { acionar: true, motivo: 'motivo valido', escopo: 'route:../x' }]) {
      const r = await post(bad, admin);
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await app.db.$count(schema.budgetKillSwitch)).toBe(0);
  });

  it('acionar global: gravado com o usuário e o motivo; auditado; o portão recusa nova reserva; liberar/conciliar continuam; desligar volta ao normal', async () => {
    const on = await post({ acionar: true, motivo: 'gasto anômalo detectado' }, admin);
    expect(on.status).toBe(200);
    expect(on.body.data.global).toMatchObject({ engaged: true, reason: 'gasto anômalo detectado', actor: admin.id });
    expect((await get(admin)).body.data.killSwitch.global.engaged).toBe(true);
    expect(await reserve(1)).toMatchObject({ ok: false, reason: 'kill_switch' });
    const open = (await app.db.select().from(schema.budgetReservations)).find((e) => e.state === 'pendente')!;
    expect((await budgetGate(app.db).commit(open.id, 3, app.clock.now, 'gen-conciliacao')).ok).toBe(true);
    const logs = (await app.db.select().from(schema.auditLog)).filter((l) => l.action === 'orcamento.kill_switch_acionado');
    expect(logs).toMatchObject([{ actorId: admin.id, resource: 'orcamento', detalhe: { escopo: 'global', motivo: 'gasto anômalo detectado' } }]);
    const off = await post({ acionar: false, motivo: 'causa corrigida e conferida' }, admin);
    expect(off.body.data.global.engaged).toBe(false);
    expect((await reserve(1)).ok).toBe(true);
    expect((await app.db.select().from(schema.auditLog)).some((l) => l.action === 'orcamento.kill_switch_desligado')).toBe(true);
    // a linha do escopo guarda o estado vigente (e o autor); o histórico completo fica no audit_log, que é append-only
    expect(await app.db.$count(schema.budgetKillSwitch)).toBe(1);
    expect((await app.db.select().from(schema.auditLog)).filter((l) => l.action.startsWith('orcamento.kill_switch')).length).toBe(2);
  });

  it('parada por rota aparece no estado (e o histórico mantém as duas mudanças)', async () => {
    const r = await post({ escopo: 'route:economy', acionar: true, motivo: 'rota economy instável' }, admin);
    expect(r.body.data.routes).toMatchObject([{ route: 'economy', reason: 'rota economy instável', actor: admin.id }]);
    const r2 = await post({ escopo: 'route:economy', acionar: false, motivo: 'rota economy estável' }, admin);
    expect(r2.body.data.routes).toEqual([]);
  });
});

describe('gateway de modelos sobre o ledger persistente', () => {
  const QUALIFIED = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'openai-text-review', 'openai-text-review-alt'];
  const callOf = async (over: Partial<GatewayCall> = {}): Promise<GatewayCall> => ({
    task: 'editorial_draft', dataClasses: ['public'], unpublished: false, mode: 'simulation', qualifiedModelIds: QUALIFIED, zdrVerifiedModelIds: [], now: app.clock.now,
    messages: [{ role: 'user', content: 'teste' }],
    estimate: { promptTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false },
    ...(await killFlags(app.db)), ...over,
  });
  const policy = () => validatePolicy(policyRaw).policy!;

  it('caminho feliz: reserva e conciliação ficam gravadas no PostgreSQL (e contam no mês)', async () => {
    const client = new SimulatedOpenRouterClient();
    const antes = await app.db.$count(schema.budgetReservations);
    const out = await callModel({ policy: policy(), gate: budgetGate(app.db), client }, await callOf());
    expect(out.status).toBe('ok');
    const novas = (await app.db.select().from(schema.budgetReservations)).slice(antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]!.route).toBe('economy'); // rota da política registrada para auditoria
    expect(novas[0]!.state).toBe('conciliada');
    expect(novas[0]!.generationId).toBe((out as { response: { id: string } }).response.id); // prova da cobrança: id da geração no provedor
  });

  it('com a parada global ativa o gateway NÃO chama o modelo: lê a parada do banco sozinho (sem o chamador informar), nenhuma reserva nova, nada gasto', async () => {
    await post({ acionar: true, motivo: 'parada de emergência do teste' }, admin);
    const client = new SimulatedOpenRouterClient();
    const antes = await app.db.$count(schema.budgetReservations);
    const out = await callModel({ policy: policy(), gate: budgetGate(app.db), client }, await callOf({ killGlobal: false, killedRoutes: [] }));
    expect(out).toMatchObject({ status: 'blocked', reason: 'kill_global' });
    // defesa em profundidade: mesmo reservando direto no portão, a parada global recusa
    expect(await reserve(1)).toMatchObject({ ok: false, reason: 'kill_switch' });
    expect(client.calls.length).toBe(0);
    expect(await app.db.$count(schema.budgetReservations)).toBe(antes);
    await post({ acionar: false, motivo: 'fim do teste de parada' }, admin);
    expect((await callModel({ policy: policy(), gate: budgetGate(app.db), client }, await callOf())).status).toBe('ok');
  });

  it('parada de rota vem do banco para o roteador, sem o chamador informar (a rota economy fica bloqueada, as outras não)', async () => {
    await post({ escopo: 'route:economy', acionar: true, motivo: 'rota economy parada no teste' }, admin);
    const client = new SimulatedOpenRouterClient();
    const out = await callModel({ policy: policy(), gate: budgetGate(app.db), client }, await callOf({ killGlobal: false, killedRoutes: [] }));
    expect(out).toMatchObject({ status: 'blocked', reason: 'kill_route' });
    expect(client.calls.length).toBe(0);
    await post({ escopo: 'route:economy', acionar: false, motivo: 'rota economy liberada' }, admin);
  });
});

describe('conciliação e taxa de compra persistidas', () => {
  it('pendente conciliado grava a geração; refill_fee é gravada e fica fora do teto', async () => {
    const { reconcilePending } = await import('@ln/modelops');
    const policy = validatePolicy(policyRaw).policy!;
    const r = await reserve(3);
    const id = (r as { reservationId: string }).reservationId;
    await budgetGate(app.db).markPending(id, 'timeout', app.clock.now);
    const out = await reconcilePending({ policy, gate: budgetGate(app.db), client: new SimulatedOpenRouterClient() }, id, async () => ({ kind: 'charged', costUsd: 2, generationId: 'gen-777' }), app.clock.now);
    expect(out).toBe('committed');
    const commit = (await app.db.select().from(schema.budgetReservations)).find((e) => e.id === id)!;
    expect(commit).toMatchObject({ state: 'conciliada', generationId: 'gen-777', actualMicrousd: 2_000_000 });
    const antes = (await budgetGate(app.db).snapshot(app.clock.now)).totalMicro;
    await budgetGate(app.db).recordRefillFee(10, app.clock.now);
    expect((await app.db.select().from(schema.budgetRefillFees)).some((e) => e.amountMicrousd === 10_000_000)).toBe(true);
    expect((await budgetGate(app.db).snapshot(app.clock.now)).totalMicro).toBe(antes); // fora do teto (DP-11)
  });
});
