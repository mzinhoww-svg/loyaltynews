import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '@ln/db/testing';
import { BudgetGate, gateConfigFromPolicy } from './budget';
import { callModel, type GatewayCall } from './gateway';
import { MemoryLedgerStore } from './ledger';
import { PostgresLedgerStore, type SqlDatabase } from './budget-pg';
import { microToUsd } from './money';
import { SimulatedOpenRouterClient, type SimulatedOptions } from './openrouter.mock';
import { loadPolicyFile, validatePolicy } from './policy';
import { estimateMicro } from './pricing';
import type { ModelPolicy } from './types';

// Modo `qualification` (T6, ADR-021). Política v6 (DP-26) com o modo LIGADO só nestes testes; como entregue ele está desligado.
const V6 = fileURLToPath(new URL('../../contracts/fixtures/model.policy.dp02-v6.json', import.meta.url));
const NOW = new Date('2026-11-23T12:00:00-03:00');
const FLAGS = { modelosHabilitados: true };

function policyV6(mutate: (p: any) => void = () => undefined, enabled = true): ModelPolicy { // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = JSON.parse(readFileSync(V6, 'utf8'));
  p.qualification.mode.enabled = enabled;
  mutate(p);
  const check = validatePolicy(p);
  if (!check.policy) throw new Error(`política inválida: ${check.errors.join('; ')}`);
  return check.policy;
}

const call = (over: Partial<GatewayCall> = {}): GatewayCall => ({
  task: 'model_qualification', dataClasses: ['public'], unpublished: false, mode: 'qualification', candidate: 'claude-haiku-5-5',
  qualifiedModelIds: [], zdrVerifiedModelIds: [], now: NOW, messages: [{ role: 'user', content: 'caso de qualificação' }],
  estimate: { promptTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false }, ...over,
});

function setup(policy: ModelPolicy = policyV6(), clientOpts: SimulatedOptions = {}, store: any = new MemoryLedgerStore()) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const gate = new BudgetGate(gateConfigFromPolicy(policy), store);
  // custo simulado padrão US$ 0,0003: abaixo da reserva (custo máximo estimado) de qualquer candidato com a estimativa padrão; custo acima da reserva é bloqueado
  const client = new SimulatedOpenRouterClient({ costUsd: 0.0003, ...clientOpts });
  return { policy, gate, client, store, deps: { policy, gate, client, flags: FLAGS } };
}
const nothing = async (s: ReturnType<typeof setup>) => {
  expect(s.client.calls).toHaveLength(0);
  expect(await s.store.readAll()).toHaveLength(0);
};

describe('política v6 (DP-26) no pacote', () => {
  it('o validador aceita a v6 (DeepSeek fora da divisão, escalonamento só do Opus) e o portão lê teto, verbas e o teto de qualificação', () => {
    const cfg = gateConfigFromPolicy(policyV6());
    expect(cfg.capMicro).toBe(50_000_000);
    expect(cfg.providerAllocationMicro).toEqual({ openai: 20_000_000, anthropic: 22_000_000 }); // sem DeepSeek
    expect(cfg.escalationSublimitMicro).toBe(5_000_000);
    expect(cfg.reserveMicro).toBe(8_000_000);
    expect(cfg.qualificationCapMicro).toBe(5_000_000);
    expect(gateConfigFromPolicy(loadPolicyFile(fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy).qualificationCapMicro).toBe(0); // v5: sem modo
  });
});

describe('modo qualification: caminho permitido', () => {
  it('candidato, tarefa e classe certos: ZDR na chamada, sem fallback, coleta negada; reserva no pool qualification com rota, conciliação com a geração', async () => {
    const s = setup();
    const out = await callModel(s.deps, call());
    expect(out.status).toBe('ok');
    expect(s.client.calls).toHaveLength(1);
    expect(s.client.calls[0]!.provider).toMatchObject({ data_collection: 'deny', zdr: true, allow_fallbacks: false });
    expect(s.client.calls[0]!.models).toBeUndefined(); // lista de modelos (fallback silencioso) proibida
    const ev = await s.store.readAll();
    expect(ev.map((e: { type: string }) => e.type)).toEqual(['reserve', 'commit']);
    expect(ev[0]).toMatchObject({ pool: 'qualification', route: 'qualification', taskId: 'model_qualification', taskClass: 'non_essential', escalation: false });
    expect(ev[1]).toMatchObject({ generationId: 'sim-1' });
    const snap = await s.gate.snapshot(NOW);
    expect(snap.qualificationMicro).toBe(300); // custo real da resposta simulada
    expect(snap.totalMicro).toBe(300); // conta no teto de US$ 50
    expect(snap.allocationMicro).toBe(300); // DP-30: debita a verba do provedor chamado
    expect(snap.providerMicro).toEqual({ anthropic: 300 });
    expect(snap.reserveMicro).toBe(0); // nunca a reserva de auditoria
  });

  it('todos os cinco candidatos do protocolo passam (Opus sem consumir o sublimite de escalonamento)', async () => {
    for (const id of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'openai-text-review', 'openai-text-review-alt']) {
      const s = setup();
      const out = await callModel(s.deps, call({ candidate: id }));
      expect(out.status, id).toBe('ok');
      expect((await s.gate.snapshot(NOW)).escalationMicro, id).toBe(0);
    }
  });

  it('persiste no PostgreSQL (pool qualification aceito pelo banco) e sobrevive a restart', async () => {
    const t = await createTestDb();
    try {
      const mk = () => setup(policyV6(), {}, new PostgresLedgerStore(t.db as unknown as SqlDatabase));
      const a = mk();
      expect((await callModel(a.deps, call())).status).toBe('ok');
      const b = mk(); // restart
      const snap = await b.gate.snapshot(NOW);
      expect(snap.qualificationMicro).toBe(300);
      expect(snap.totalMicro).toBe(300);
    } finally {
      await t.close();
    }
  });
});

describe('modo qualification: recusas ANTES de reservar ou enviar', () => {
  const bloqueia = async (s: ReturnType<typeof setup>, c: GatewayCall, reason: string) => {
    const out = await callModel(s.deps, c);
    expect(out).toMatchObject({ status: 'blocked', reason });
    await nothing(s);
  };

  it('como entregue, o modo está DESLIGADO na política: nada roda', async () => {
    await bloqueia(setup(policyV6(() => undefined, false)), call(), 'qualification_disabled');
  });

  it('política sem o modo (v5): qualification_absent', async () => {
    const v5 = loadPolicyFile(fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy;
    await bloqueia(setup(v5), call(), 'qualification_absent');
  });

  it('produção ligada: qualificação e produção não convivem (o contrato recusa o documento e, mesmo que alguém o altere em memória, o gateway recusa)', async () => {
    expect(() => policyV6((p) => { p.rules.production_enabled = true; })).toThrow(/production_enabled=false/);
    const base = policyV6();
    const ligada = { ...base, rules: { ...base.rules, production_enabled: true } } as ModelPolicy;
    const s = setup(ligada);
    const out = await callModel(s.deps, call());
    expect(out).toMatchObject({ status: 'blocked', reason: 'qualification_requires_production_off' });
    await nothing(s);
  });

  it('sem a flag modelosHabilitados: model_calls_disabled', async () => {
    const s = setup();
    const out = await callModel({ ...s.deps, flags: {} }, call());
    expect(out).toMatchObject({ status: 'blocked', reason: 'model_calls_disabled' });
    await nothing(s);
  });

  it('tarefa diferente de model_qualification', async () => {
    for (const task of ['editorial_draft', 'qualificacao', '', 'wf08_correction']) await bloqueia(setup(), call({ task }), 'qualification_task');
  });

  it('classe de dado diferente de public (ou vazia ou mista)', async () => {
    for (const dataClasses of [['internal'], ['personal'], ['public', 'internal'], ['secret'], []]) await bloqueia(setup(), call({ dataClasses }), 'qualification_data_class');
  });

  it('Fable e DeepSeek: excluídos mesmo se alguém tentar nomeá-los', async () => {
    for (const candidate of ['claude-fable-5-2', 'deepseek-v4-pro', 'deepseek-flash']) await bloqueia(setup(), call({ candidate }), 'qualification_excluded');
  });

  it('modelo que não é candidato do protocolo, inexistente ou ausente', async () => {
    for (const candidate of ['gpt-image-2.6-flare', 'modelo-que-nao-existe', 'openai/gpt-6.1-terra']) await bloqueia(setup(), call({ candidate }), 'qualification_candidate');
    await bloqueia(setup(), call({ candidate: undefined }), 'qualification_candidate');
  });

  it('kill switch: global (do chamador ou persistido) e da rota qualification', async () => {
    await bloqueia(setup(), call({ killGlobal: true }), 'kill_global');
    await bloqueia(setup(), call({ killedRoutes: ['qualification'] }), 'kill_route');
    const s = setup();
    await s.store.setKill('global', true, 'parada de teste', NOW);
    await bloqueia(s, call(), 'kill_global');
    const r = setup();
    await r.store.setKill('route:qualification', true, 'rota parada', NOW);
    await bloqueia(r, call(), 'kill_route');
    const outra = setup();
    await outra.store.setKill('route:economy', true, 'outra rota', NOW);
    expect((await callModel(outra.deps, call())).status).toBe('ok'); // a parada de outra rota não afeta a qualificação
  });
});

describe('modo qualification: teto próprio de US$ 5 e teto mensal', () => {
  const uc = (policy: ModelPolicy, id: string, tokens: number) => microToUsd(estimateMicro(policy.models.find((m) => m.id === id)!, { promptTokens: tokens, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false })!);

  it('estourar o teto de qualificação recusa a reserva (nenhuma chamada sai); o que coube segue valendo', async () => {
    const policy = policyV6();
    const s = setup(policy, { costUsd: 1.9 });
    // acha um tamanho de prompt cuja reserva fique perto de US$ 1,9 no modelo escolhido
    let tokens = 1000;
    while (uc(policy, 'claude-haiku-5-5', tokens) < 1.9) tokens += 20_000;
    const big = (over: Partial<GatewayCall> = {}) => call({ estimate: { promptTokens: tokens, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false }, ...over });
    const reservado = uc(policy, 'claude-haiku-5-5', tokens);
    expect(reservado).toBeGreaterThanOrEqual(1.9);
    expect(reservado).toBeLessThan(2.6);
    const r1 = await callModel(s.deps, big());
    const r2 = await callModel(s.deps, big());
    expect(r1.status).toBe('ok');
    const snap = await s.gate.snapshot(NOW);
    expect(snap.qualificationMicro).toBeLessThanOrEqual(5_000_000);
    const r3 = await callModel(s.deps, big());
    if (r2.status === 'ok' && r3.status === 'ok') throw new Error('o teto de US$ 5 deveria ter parado a qualificação');
    const recusa = [r2, r3].find((r) => r.status === 'blocked');
    expect(recusa).toMatchObject({ status: 'blocked', reason: 'budget_refused', detail: 'qualification_cap' });
    expect((await s.gate.snapshot(NOW)).qualificationMicro).toBeLessThanOrEqual(5_000_000);
    expect(s.client.calls.length).toBeLessThanOrEqual(3);
  });

  it('a qualificação conta no teto mensal de US$ 50: com US$ 48,5 gastos pela produção, uma reserva que passaria de 50 é recusada (hard_cap)', async () => {
    const policy = policyV6();
    const s = setup(policy, { costUsd: 0.01 });
    // gasto de produção: openai 20 + anthropic 22 (+ escalonamento já dentro) + reserva de auditoria 6,5 = 48,5
    const base = { lane: 'text' as const, escalation: false, at: NOW };
    for (const [provider, amountUsd] of [['openai', 20], ['anthropic', 22]] as const) {
      expect((await s.gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', provider, model: 'm', amountUsd, ...base })).ok).toBe(true);
    }
    expect((await s.gate.reserve({ taskId: 'wf08_correction', taskClass: 'reserve', provider: 'anthropic', model: 'm', amountUsd: 6.5, ...base })).ok).toBe(true);
    let tokens = 1000;
    while (uc(policy, 'claude-haiku-5-5', tokens) < 2) tokens += 20_000;
    const out = await callModel(s.deps, call({ estimate: { promptTokens: tokens, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false } }));
    expect(out).toMatchObject({ status: 'blocked', reason: 'budget_refused', detail: 'hard_cap' });
    expect(s.client.calls).toHaveLength(0);
  });

  it('DP-30: a qualificação debita a verba do provedor chamado e nunca a reserva de 8; a verba de produção restante diminui na mesma medida', async () => {
    const policy = policyV6();
    const s = setup(policy, { costUsd: 0.2 });
    for (let i = 0; i < 3; i++) await callModel(s.deps, call()); // anthropic (haiku): 3 x US$ 0,20
    const snap = await s.gate.snapshot(NOW);
    expect(snap.providerMicro.anthropic).toBe(600_000);
    expect(snap.reserveMicro).toBe(0);
    expect(snap.escalationMicro).toBe(0);
    // produção: a verba de 22 da Anthropic já tem US$ 0,60 gastos pela qualificação
    expect((await s.gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 22, at: NOW }))).toMatchObject({ ok: false, reason: 'provider_allocation_exhausted' });
    expect((await s.gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 21.4, at: NOW })).ok).toBe(true);
    // a OpenAI continua intacta
    expect((await s.gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'openai', model: 'm', escalation: false, amountUsd: 20, at: NOW })).ok).toBe(true);
  });

  it('com a verba do provedor esgotada pela produção, a qualificação desse provedor é recusada (provider_allocation_exhausted) e a do outro segue', async () => {
    const policy = policyV6();
    const s = setup(policy);
    expect((await s.gate.reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 22, at: NOW })).ok).toBe(true);
    const bloqueada = await callModel(s.deps, call({ candidate: 'claude-haiku-5-5' }));
    expect(bloqueada).toMatchObject({ status: 'blocked', reason: 'budget_refused', detail: 'provider_allocation_exhausted' });
    expect(s.client.calls).toHaveLength(0);
    expect((await callModel(s.deps, call({ candidate: 'openai-text-review' }))).status).toBe('ok');
  });
});

describe('modo qualification: falhas, sem fallback, evidência', () => {
  it('rejeição sem cobrança (429): reserva liberada e NENHUMA segunda tentativa (allow_fallbacks=false, sem trocar de candidato)', async () => {
    const s = setup(policyV6(), { failFirst: 5, failKind: 'rejected' });
    const out = await callModel(s.deps, call());
    expect(out).toMatchObject({ status: 'blocked', reason: 'provider_rejected' });
    expect(s.client.calls).toHaveLength(1);
    expect((await s.store.readAll()).map((e: { type: string }) => e.type)).toEqual(['reserve', 'release']);
    expect((await s.gate.snapshot(NOW)).qualificationMicro).toBe(0);
  });

  it('falha incerta depois do envio: a reserva fica pendente e conta no teto até conciliar', async () => {
    const s = setup(policyV6(), { failFirst: 1, failKind: 'uncertain' });
    const out = await callModel(s.deps, call());
    expect(out).toMatchObject({ status: 'blocked', reason: 'pending_reconciliation' });
    expect(s.client.calls).toHaveLength(1);
    const snap = await s.gate.snapshot(NOW);
    expect(snap.pendingReservations).toBe(1);
    expect(snap.qualificationMicro).toBeGreaterThan(0);
  });

  it('evidência incompleta (sem geração): a chamada custou e conta, mas a saída não vale', async () => {
    const s = setup(policyV6(), { omitGeneration: true });
    const out = await callModel(s.deps, call());
    expect(out).toMatchObject({ status: 'blocked', reason: 'evidence_invalid' });
    expect((await s.gate.snapshot(NOW)).qualificationMicro).toBe(300);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Reprovação do QA 1 em 53d15fc: (1) evidência de OUTRO modelo era aceita; (2) `ok` com custo acima do teto. Política v7 (DP-27/DP-30):
// teto POR ETAPA (1 = US$ 5, 2 = US$ 10), conferido ANTES de reservar; custo real acima do reservado/teto da etapa = bloqueado.
// ---------------------------------------------------------------------------------------------------------------------
const V7 = fileURLToPath(new URL('../../contracts/fixtures/model.policy.dp02-v7.json', import.meta.url));
function policyV7(mutate: (p: any) => void = () => undefined): ModelPolicy { // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = JSON.parse(readFileSync(V7, 'utf8'));
  p.qualification.mode.enabled = true;
  mutate(p);
  const check = validatePolicy(p);
  if (!check.policy) throw new Error(`política inválida: ${check.errors.join('; ')}`);
  return check.policy;
}
const est = (tokens: number) => ({ promptTokens: tokens, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: 500, uncertain: false });
/** Custo máximo reservado (US$) de `id` para `tokens` de prompt. */
const reservaDe = (policy: ModelPolicy, id: string, tokens: number) => microToUsd(estimateMicro(policy.models.find((m) => m.id === id)!, est(tokens))!);

describe('QA 1: a evidência precisa ser do modelo PEDIDO', () => {
  it('sonda do QA: pediu Haiku e a resposta (e a geração) são de outro modelo ⇒ bloqueado, custo gravado, NÃO conta como qualificado', async () => {
    const s = setup(policyV6(), { responseModel: 'openai/gpt-6.1-terra' });
    const out = await callModel(s.deps, call());
    expect(out).toMatchObject({ status: 'blocked', reason: 'evidence_model_mismatch' });
    expect((out as { detail: string }).detail).toContain('anthropic/claude-haiku-5.5');
    expect((out as { costUsd?: number }).costUsd).toBeGreaterThan(0);
    expect((await s.gate.snapshot(NOW)).qualificationMicro).toBe(300); // a chamada custou e fica no ledger
  });

  it('resposta e geração discordando entre si seguem inválidas (evidence_invalid), antes mesmo de comparar com o pedido', async () => {
    const s = setup();
    const orig = s.client.chat.bind(s.client);
    s.client.chat = async (b) => {
      const r = await orig(b);
      return { ...r, generation: { ...r.generation, model: 'openai/gpt-6.1-terra' } };
    };
    expect(await callModel(s.deps, call())).toMatchObject({ status: 'blocked', reason: 'evidence_invalid' });
  });

  it('o slug canônico do vínculo (versão datada que o OpenRouter devolve) é aceito; id do pedido também', async () => {
    const policy = policyV7();
    const slug = policy.models.find((m) => m.id === 'claude-haiku-5-5')!.binding!.canonical_slug;
    expect(slug).not.toBe(policy.models.find((m) => m.id === 'claude-haiku-5-5')!.binding!.openrouter_id);
    const a = setup(policy, { responseModel: slug });
    expect(await callModel(a.deps, call({ stage: '1' }))).toMatchObject({ status: 'ok', model: 'anthropic/claude-haiku-5.5' });
    const b = setup(policy);
    expect((await callModel(b.deps, call({ stage: '1' }))).status).toBe('ok');
  });

  it('modelo parecido mas diferente (outra versão do mesmo autor) não passa', async () => {
    const s = setup(policyV7(), { responseModel: 'anthropic/claude-haiku-5.4' });
    expect(await callModel(s.deps, call({ stage: '1' }))).toMatchObject({ status: 'blocked', reason: 'evidence_model_mismatch' });
  });
});

describe('QA 1: teto por etapa (v7) conferido ANTES, e custo acima do teto nunca é ok', () => {
  it('o portão da v7 lê o pool como a soma das etapas (15) e a v6 segue com o cap_usd (5)', () => {
    expect(gateConfigFromPolicy(policyV7()).qualificationCapMicro).toBe(15_000_000);
    expect(gateConfigFromPolicy(policyV6()).qualificationCapMicro).toBe(5_000_000);
  });

  it('v7 exige a etapa: sem ela, ou com etapa sem teto, nada é reservado nem enviado', async () => {
    const a = setup(policyV7());
    expect(await callModel(a.deps, call())).toMatchObject({ status: 'blocked', reason: 'qualification_stage' });
    await nothing(a);
    const b = setup(policyV7((p) => { delete p.qualification.mode.stage_caps_usd['2']; }));
    expect(await callModel(b.deps, call({ stage: '2' }))).toMatchObject({ status: 'blocked', reason: 'qualification_stage' });
    await nothing(b);
  });

  it('sonda do QA: etapa 1 (teto US$ 5), reserva cabendo e custo real US$ 5,01 ⇒ BLOQUEADO (nunca ok com overrun); o gasto real fica no ledger', async () => {
    const policy = policyV7();
    let tokens = 1_000_000; // acima de 272 mil tokens a OpenAI cobra a faixa de contexto longo (US$ 2/Mtok)
    while (reservaDe(policy, 'openai-text-review', tokens) < 4.9) tokens += 50_000;
    expect(reservaDe(policy, 'openai-text-review', tokens)).toBeLessThanOrEqual(5);
    const s = setup(policy, { costUsd: 5.01 });
    const out = await callModel(s.deps, call({ candidate: 'openai-text-review', stage: '1', estimate: est(tokens) }));
    expect(out).toMatchObject({ status: 'blocked', reason: 'qualification_cost_overrun', costUsd: 5.01 });
    const snap = await s.gate.snapshot(NOW);
    expect(snap.qualificationMicro).toBe(5_010_000); // o que foi cobrado de verdade
    expect(snap.reserveMicro).toBe(0);
  });

  it('o mesmo vale na v6 (teto único) e para qualquer custo acima do reservado, mesmo longe do teto', async () => {
    const s = setup(policyV6(), { costUsd: 0.0004 }); // reserva de US$ 0,00035 (Haiku, 1000+500 tokens) e cobrança de 0,0004
    const out = await callModel(s.deps, call());
    expect(out).toMatchObject({ status: 'blocked', reason: 'qualification_cost_overrun' });
    expect((await s.gate.snapshot(NOW)).qualificationMicro).toBe(400);
  });

  it('custo dentro da reserva e do teto: ok, sem overrun', async () => {
    const s = setup(policyV7());
    expect(await callModel(s.deps, call({ stage: '1' }))).toMatchObject({ status: 'ok', overrun: false });
  });

  it('a reserva (custo máximo estimado) acima do teto da etapa é recusada ANTES de qualquer envio ou reserva', async () => {
    const policy = policyV7();
    let tokens = 1_000_000;
    while (reservaDe(policy, 'openai-text-review', tokens) <= 5) tokens += 50_000;
    const s = setup(policy);
    expect(await callModel(s.deps, call({ candidate: 'openai-text-review', stage: '1', estimate: est(tokens) }))).toMatchObject({ status: 'blocked', reason: 'qualification_cap' });
    await nothing(s);
    // a MESMA reserva cabe na etapa 2 (teto US$ 10)
    const t = setup(policy);
    expect((await callModel(t.deps, call({ candidate: 'openai-text-review', stage: '2', estimate: est(tokens) }))).status).toBe('ok');
  });

  it('o gasto da etapa soma: depois de gastar na etapa 1, a reserva que passaria de US$ 5 é recusada, mas a etapa 2 segue com o seu teto', async () => {
    const policy = policyV7();
    let tokens = 1_000_000;
    while (reservaDe(policy, 'openai-text-review', tokens) < 2.4) tokens += 100_000;
    const s = setup(policy, { costUsd: 2.4 });
    const c = (stage: '1' | '2') => call({ candidate: 'openai-text-review', stage, estimate: est(tokens) });
    expect((await callModel(s.deps, c('1'))).status).toBe('ok');
    expect((await callModel(s.deps, c('1'))).status).toBe('ok'); // 2 x ~2,4 = ~4,8 na etapa 1
    const terceira = await callModel(s.deps, c('1'));
    expect(terceira).toMatchObject({ status: 'blocked', reason: 'budget_refused', detail: 'qualification_cap' });
    expect(s.client.calls).toHaveLength(2);
    expect((await callModel(s.deps, c('2'))).status).toBe('ok'); // a etapa 2 não herda o gasto da 1
    const ev = (await s.store.readAll()).filter((e: { type: string }) => e.type === 'reserve') as { taskId: string; pool: string }[];
    expect(ev.map((e) => e.taskId)).toEqual(['model_qualification:1', 'model_qualification:1', 'model_qualification:2']);
    expect(ev.every((e) => e.pool === 'qualification')).toBe(true);
  });

  it('persiste a etapa no PostgreSQL e o teto da etapa vale depois de reiniciar', async () => {
    const t = await createTestDb();
    try {
      const policy = policyV7();
      let tokens = 1_000_000;
      while (reservaDe(policy, 'openai-text-review', tokens) < 2.6) tokens += 100_000;
      const mk = () => setup(policy, { costUsd: 2.6 }, new PostgresLedgerStore(t.db as unknown as SqlDatabase));
      const c = call({ candidate: 'openai-text-review', stage: '1', estimate: est(tokens) });
      expect((await callModel(mk().deps, c)).status).toBe('ok');
      expect(await callModel(mk().deps, c)).toMatchObject({ status: 'blocked', reason: 'budget_refused' }); // 2,6 + 2,6 > 5, depois do restart
    } finally {
      await t.close();
    }
  });
});
