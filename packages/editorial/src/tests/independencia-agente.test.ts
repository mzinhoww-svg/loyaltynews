// DP-71 (27/11): no piloto o provedor pode ser o mesmo; a checagem e a revisão são independentes por AGENTE e por execução. Falta de prova recusa.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { MOCK_SOURCE, mockResolver, mockWeb, COLLECT_ON } from '../../fixtures/mock-web.mock';
import { goodDraftOutput, MockGateway, mockOk } from '../../fixtures/mock-gateway.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog, type IndependenceMode, type StageDeps } from '../pipeline/stages';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { ArticleJob, StageOutcome } from '../pipeline/jobs';
import type { TaskClass } from '../gateway';

const ev = (await new Collector(mockWeb(), { minSpacingMs: 0, now: () => new Date('2026-11-23T12:00:00Z'), resolver: mockResolver(), flags: COLLECT_ON })
  .collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;
const registry = new SourceRegistry([MOCK_SOURCE]);
const VERDITOS = { verdicts: ['c1', 'c2', 'c3', 'c4'].map((claimId) => ({ claimId, verdict: 'pass' })) };

type Quem = { agent?: string; taskId?: string; provider?: string };
const PADRAO: Record<'draft' | 'factcheck' | 'review', Quem> = {
  draft: { agent: 'openbot-opencode-redacao', taskId: 't-draft' },
  factcheck: { agent: 'openbot-opencode-checagem', taskId: 't-fact' },
  review: { agent: 'openbot-opencode-revisao', taskId: 't-review' },
};
/** Todas as etapas no MESMO provedor; quem muda é o agente e a tarefa. */
function gateway(quem: Partial<Record<'draft' | 'factcheck' | 'review', Quem>> = {}) {
  const resposta = (classe: 'draft' | 'factcheck' | 'review', saida: unknown) => () => {
    const q = { provider: 'deepseek', ...PADRAO[classe], ...quem[classe] };
    return { ...(mockOk(q.provider, saida) as object), ...(q.agent !== undefined ? { agent: q.agent } : {}), ...(q.taskId !== undefined ? { taskId: q.taskId, attempt: 1 } : {}) } as ReturnType<typeof mockOk>;
  };
  return new MockGateway(ev.id, { draft: resposta('draft', goodDraftOutput(ev.id)), factcheck: resposta('factcheck', VERDITOS), review: resposta('review', { approve: true, issues: [] }) });
}

async function rodar(gw: MockGateway, independence: IndependenceMode | undefined, job: Partial<ArticleJob> = {}, inicio: 'triage' | 'factcheck' | 'review' = 'triage') {
  const patches: Array<{ stage: string; patch: Record<string, unknown> }> = [];
  const d: StageDeps = {
    gateway: gw, registry, audit: new InMemoryAuditLog(), flags: { editorialPipeline: true }, now: () => new Date('2026-11-23T12:00:00Z'),
    pilotSink: { patch: async (p) => { patches.push(p as never); } }, ...(independence ? { independence } : {}),
  };
  const q = new InMemoryQueue();
  const done: StageOutcome[] = [];
  const barrados: StageOutcome[] = [];
  const proc = makeProcessor(d, q, { onDone: (o) => { done.push(o); }, onBlocked: (o) => { barrados.push(o); } });
  const data: ArticleJob = { articleId: 'a1', editoria: 'pontos', evidences: [ev], attempt: 0, ...job };
  await q.enqueue({ stage: inicio, jobId: `a1:${inicio}:0`, data });
  await q.drain(proc);
  const b = barrados[0]?.kind === 'blocked' ? barrados[0].blocked : undefined;
  const pedidos = (c: TaskClass) => gw.requests.filter((r) => r.taskClass === c);
  const linha = (stage: string) => patches.filter((p) => p.stage === stage && 'gate_verdict' in p.patch).map((p) => p.patch);
  return { done, b, pedidos, linha, etapas: q.processed.map((p) => p.spec.stage) };
}

test('mesmo provedor + agentes diferentes: ACEITO até a aprovação; a linha registra o fato do provedor', async () => {
  const r = await rodar(gateway(), 'agent');
  assert.equal(r.b, undefined, JSON.stringify(r.b));
  assert.equal(r.done[0]?.kind === 'done' && r.done[0].event, 'article.approved');
  assert.deepEqual(r.pedidos('factcheck')[0]!.excludeProviders, [], 'não manda excluir o provedor do redator');
  for (const etapa of ['factcheck', 'review']) assert.deepEqual(r.linha(etapa), [{ gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: false }]);
});

const RECUSAS: Array<[string, Quem, string, string]> = [
  ['mesmo agente', { agent: 'openbot-opencode-redacao' }, 'same_agent', 'same_author'],
  ['mesmo agente com outra grafia', { agent: '  OpenBot-OpenCode-Redacao ' }, 'same_agent', 'same_author'],
  ['mesmo agente em OUTRO provedor', { agent: 'openbot-opencode-redacao', provider: 'openai' }, 'same_agent', 'same_author'],
  ['mesma execução da redação', { taskId: 't-draft' }, 'same_execution', 'same_author'],
  ['sem agente informado', { agent: undefined }, 'agent_unproven', 'cross_provider_check_failed'],
  ['agente vazio', { agent: '   ' }, 'agent_unproven', 'cross_provider_check_failed'],
  ['sem tarefa informada', { taskId: undefined }, 'agent_unproven', 'cross_provider_check_failed'],
];
for (const etapa of ['factcheck', 'review'] as const) {
  for (const [nome, quem, codigo, motivo] of RECUSAS) {
    test(`${etapa}: ${nome} = RECUSADO (${codigo})`, async () => {
      const r = await rodar(gateway({ [etapa]: quem }), 'agent');
      assert.equal(r.done.length, 0);
      assert.equal(r.b?.stage, etapa);
      assert.deepEqual(r.b?.blockers, ['cross_provider_check_failed']);
      assert.deepEqual(r.b?.findings.map((f) => f.code), [codigo]);
      // o veredito da recusa fica na linha (sem ele, duas seguidas parariam o piloto inteiro)
      if (quem.taskId !== undefined || !('taskId' in quem)) assert.deepEqual(r.linha(etapa).map((p) => [p['gate_verdict'], p['gate_reasons']]), [['blocked', [motivo]]]);
      if (etapa === 'factcheck') assert.equal(r.pedidos('review').length, 0);
    });
  }
}

test('redator sem agente identificado: a checagem nem é pedida', async () => {
  const r = await rodar(gateway({ draft: { agent: undefined } }), 'agent');
  assert.equal(r.b?.stage, 'factcheck');
  assert.deepEqual(r.b?.findings.map((f) => f.code), ['agent_unproven']);
  assert.equal(r.pedidos('factcheck').length, 0);
});

test('a revisão não confia na checagem anterior: checagem do próprio redator, ou sem prova, não chega ao revisor', async () => {
  const completo = await rodar(gateway(), 'agent');
  const aprovado = completo.done[0]!;
  assert.ok(aprovado.kind === 'done');
  for (const [checagem, codigo] of [[{ agent: 'openbot-opencode-redacao' }, 'same_agent'], [{ taskId: 't-draft' }, 'same_execution'], [{ agent: undefined }, 'agent_unproven']] as const) {
    const gw = gateway();
    const r = await rodar(gw, 'agent', { ...aprovado.data, approved: false, factcheck: { ...aprovado.data.factcheck!, ...checagem } }, 'review');
    assert.deepEqual([r.b?.stage, r.b?.findings.map((f) => f.code)], ['review', [codigo]]);
    assert.equal(r.pedidos('review').length, 0);
  }
});

test('nova redação não herda o agente da anterior', async () => {
  const r = await rodar(gateway({ draft: { agent: undefined } }), 'agent', { draftAgent: 'agente-antigo', draftTaskId: 't-antigo' });
  assert.deepEqual(r.b?.findings.map((f) => f.code), ['agent_unproven']);
});

test('fora do piloto (modo ausente ou provider) nada muda: mesmo provedor segue recusado mesmo com agentes diferentes', async () => {
  for (const modo of [undefined, 'provider'] as const) {
    const r = await rodar(gateway(), modo);
    assert.deepEqual([r.b?.stage, r.b?.blockers, r.b?.findings.map((f) => f.code)], ['factcheck', ['cross_provider_check_failed'], ['same_provider']]);
    assert.deepEqual(r.pedidos('factcheck')[0]!.excludeProviders, ['deepseek']);
  }
});
