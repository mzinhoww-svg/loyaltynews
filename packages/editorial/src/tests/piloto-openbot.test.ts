import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver, mockWeb } from '../../fixtures/mock-web.mock';
import { MockGateway, goodDraftOutput } from '../../fixtures/mock-gateway.mock';
import { draft as draftStage, factcheck as factcheckStage, review as reviewStage, InMemoryAuditLog } from '../pipeline/stages';
import type { StageDeps } from '../pipeline/stages';
import { SourceRegistry } from '../sources/registry';
import { pilotRowSinkFrom } from '../pipeline/pilot-sink';
import type { PilotRowPatch, PilotRowSink } from '../pipeline/pilot-sink';
import type { ArticleJob } from '../pipeline/jobs';
import type { GatewayRequest, GatewayResponse } from '../gateway';

// Piloto pelo OpenBot (DP-41): o gateway devolve o id da TAREFA e a tentativa; a Editorial liga checagem/revisão ao rascunho avaliado
// (`reviewedDraftTaskId` real) e grava o veredito do gate e `output_valid` na linha do piloto.

const NOW = () => new Date('2026-11-23T12:00:00Z');
const ev = (await new Collector(mockWeb(), { now: NOW, resolver: mockResolver(), flags: COLLECT_ON, minSpacingMs: 0 }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;
const usage = { inputTokens: 0, outputTokens: 0, costMicrosUsd: 0 };
const withTask = (provider: string, output: unknown, taskId?: string, attempt = 1): GatewayResponse => ({ ok: true, provider, model: `${provider}-m`, output, usage, ...(taskId ? { taskId, attempt } : {}) });

class Sink implements PilotRowSink {
  calls: Array<{ taskId: string; attempt: number; stage: string; patch: PilotRowPatch }> = [];
  fail = false;
  async patch(p: { taskId: string; attempt: number; stage: string; patch: PilotRowPatch }): Promise<void> { if (this.fail) throw new Error('linha inexistente'); this.calls.push(p); }
}
function setup(over: Record<string, (r: GatewayRequest) => GatewayResponse> = {}, tasks = true) {
  const requests: GatewayRequest[] = [];
  const gw = new MockGateway(ev.id, {
    draft: (r) => { requests.push(r); return withTask('deepseek', goodDraftOutput(ev.id), tasks ? 'task-draft-7' : undefined); },
    factcheck: (r) => { requests.push(r); return withTask('anthropic', { verdicts: ['c1', 'c2', 'c3', 'c4'].map((claimId) => ({ claimId, verdict: 'pass' })) }, tasks ? 'task-fc-8' : undefined, 2); },
    review: (r) => { requests.push(r); return withTask('anthropic', { approve: true, issues: [] }, tasks ? 'task-rv-9' : undefined); },
    ...over,
  });
  const sink = new Sink(); const audit = new InMemoryAuditLog();
  const deps: StageDeps = { gateway: gw, registry: new SourceRegistry([MOCK_SOURCE]), audit, flags: { editorialPipeline: true }, now: NOW, pilotSink: sink };
  const job: ArticleJob = { articleId: 'art1', editoria: 'pontos', evidences: [ev], attempt: 0 };
  return { requests, deps, sink, audit, job };
}
const inputOf = (r: GatewayRequest) => r.input as { reviewedDraftTaskId?: string; reviewedDraft?: { taskId: string; draftId: string; sha256: string } };
async function run(s: ReturnType<typeof setup>) {
  const d = await draftStage(s.deps, s.job); assert.equal(d.kind, 'next'); if (d.kind !== 'next') throw new Error('draft');
  const f = await factcheckStage(s.deps, d.next.data);
  if (f.kind !== 'next') return { d, f };
  const r = await reviewStage(s.deps, f.next.data);
  return { d, f, r };
}

test('o id da TAREFA de redação (devolvido pelo gateway) vira reviewedDraftTaskId da checagem e da revisão; a redação não o recebe', async () => {
  const s = setup();
  const out = await run(s);
  assert.equal(out.r!.kind, 'done');
  const [draftReq, fcReq, rvReq] = s.requests;
  assert.equal(inputOf(draftReq!).reviewedDraftTaskId, undefined);
  assert.equal(inputOf(fcReq!).reviewedDraftTaskId, 'task-draft-7'); assert.equal(inputOf(rvReq!).reviewedDraftTaskId, 'task-draft-7');
  assert.equal(inputOf(fcReq!).reviewedDraft!.taskId, 'task-draft-7'); assert.equal(inputOf(rvReq!).reviewedDraft!.sha256, inputOf(fcReq!).reviewedDraft!.sha256);
  assert.match(fcReq!.idempotencyKey, /^art1:factcheck:\d+$/, 'a chave de idempotência mantém o formato <matéria>:<classe>:<tentativa>');
  const rec = out.r!.kind === 'done' ? out.r!.data : null;
  assert.equal(rec!.review!.reviewedDraftTaskId, 'task-draft-7'); assert.equal(rec!.factcheck!.reviewedDraftTaskId, 'task-draft-7');
});

test('sem taskId no gateway (modelops): nenhum reviewedDraftTaskId inventado; o id derivado continua em reviewedDraft', async () => {
  const s = setup({}, false);
  await run(s);
  const fcReq = s.requests[1]!;
  assert.equal(inputOf(fcReq).reviewedDraftTaskId, undefined);
  assert.equal(inputOf(fcReq).reviewedDraft!.taskId, 'art1:draft:0');
  assert.deepEqual(s.sink.calls, [], 'sem id de tarefa não há linha a patchar');
});

test('linha do piloto: output_valid em cada tarefa; veredito do gate na redação, na checagem e na revisão (tarefa e tentativa do gateway)', async () => {
  const s = setup();
  await run(s);
  const by = (stage: string) => s.sink.calls.filter((c) => c.stage === stage);
  assert.deepEqual(by('draft').map((c) => [c.taskId, c.attempt, c.patch]), [['task-draft-7', 1, { output_valid: true }], ['task-draft-7', 1, { gate_verdict: 'approved', gate_reasons: [] }]]);
  assert.deepEqual(by('factcheck').map((c) => [c.taskId, c.attempt, c.patch]), [
    ['task-fc-8', 2, { output_valid: true }],
    ['task-fc-8', 2, { gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: true }],
  ]);
  assert.deepEqual(by('review').map((c) => c.patch), [{ output_valid: true }, { gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: true }]);
});

test('veredito "blocked" com o motivo certo: claim não aprovada, mesmo provedor do redator e revisão que reprova; saída fora do formato = output_valid false', async () => {
  const fail = setup({ factcheck: () => withTask('anthropic', { verdicts: [{ claimId: 'c1', verdict: 'fail' }, { claimId: 'c2', verdict: 'pass' }, { claimId: 'c3', verdict: 'pass' }, { claimId: 'c4', verdict: 'pass' }] }, 'task-fc-1') });
  const o1 = await run(fail);
  assert.equal(o1.f.kind, 'blocked');
  assert.deepEqual(fail.sink.calls.at(-1)!.patch, { gate_verdict: 'blocked', gate_reasons: ['unsupported_claim'], cross_provider_ok: true });

  const same = setup({ factcheck: () => withTask('deepseek', { verdicts: ['c1', 'c2', 'c3', 'c4'].map((claimId) => ({ claimId, verdict: 'pass' })) }, 'task-fc-2') });
  await run(same);
  assert.deepEqual(same.sink.calls.at(-1)!.patch, { gate_verdict: 'blocked', gate_reasons: ['cross_provider_check_failed'], cross_provider_ok: false });

  const rej = setup({ review: () => withTask('anthropic', { approve: false, issues: ['título fraco'] }, 'task-rv-3') });
  const o3 = await run(rej);
  assert.equal(o3.r!.kind, 'blocked');
  assert.deepEqual(rej.sink.calls.at(-1)!.patch, { gate_verdict: 'blocked', gate_reasons: ['approval_missing'], cross_provider_ok: true });

  const bad = setup({ factcheck: () => withTask('anthropic', { verdicts: [{ claimId: 'c1', verdict: 'talvez' }] }, 'task-fc-4') });
  await run(bad);
  assert.deepEqual(bad.sink.calls.find((c) => c.stage === 'factcheck')!.patch, { output_valid: false });
});

test('falha ao gravar na linha NUNCA muda o gate: vira auditoria e a linha fica pendente', async () => {
  const s = setup();
  s.sink.fail = true;
  const out = await run(s);
  assert.equal(out.r!.kind, 'done', 'o resultado do pipeline é o mesmo');
  const failed = s.audit.entries.filter((e) => e.event === 'pilot_row_patch_failed');
  assert.ok(failed.length >= 3 && failed.every((e) => /linha inexistente/.test(e.detail ?? '')));
});

test('pilotRowSinkFrom: confere com applyRowPatch contra a linha atual e só então grava; linha ausente ou patch recusado lançam (sem gravar)', async () => {
  const rows = [{ task_id: 't1', attempt: 1, stage: 'review' }];
  const patched: unknown[] = [];
  const store = { all: async () => rows, patch: async (t: string, a: number, f: Record<string, unknown>) => { patched.push([t, a, f]); return true; } };
  const apply = (row: never, patch: Record<string, unknown>) => ({ row: { ...(row as object), ...patch }, errors: 'tarifada_api_call' in patch ? ['campo tarifada_api_call não pode ser alterado por patch'] : [] });
  const sink = pilotRowSinkFrom(store, apply);
  await sink.patch({ taskId: 't1', attempt: 1, stage: 'review', patch: { gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: true } });
  assert.deepEqual(patched, [['t1', 1, { gate_verdict: 'approved', gate_reasons: [], cross_provider_ok: true }]]);
  await assert.rejects(() => sink.patch({ taskId: 'nada', attempt: 1, stage: 'review', patch: { output_valid: true } }), /linha do piloto inexistente/);
  await assert.rejects(() => sink.patch({ taskId: 't1', attempt: 1, stage: 'review', patch: { tarifada_api_call: true } as never }), /patch recusado/);
  assert.equal(patched.length, 1);
  const sumiu = pilotRowSinkFrom({ ...store, patch: async () => false }, apply);
  await assert.rejects(() => sumiu.patch({ taskId: 't1', attempt: 1, stage: 'review', patch: { output_valid: true } }), /sumiu/);
});

test('gate da redação barra (cópia/número fora da fonte): a linha da tarefa de redação recebe gate_verdict blocked e os motivos; sem nova tentativa', async () => {
  const s = setup({ draft: () => withTask('deepseek', goodDraftOutput(ev.id, { body: 'A diretora disse: "frase totalmente inventada pelo modelo de teste".' }), 'task-draft-9') });
  const o = await draftStage(s.deps, s.job);
  assert.equal(o.kind, 'blocked');
  const rows = s.sink.calls.filter((c) => c.stage === 'draft');
  assert.deepEqual(rows.map((c) => [c.taskId, c.patch.gate_verdict]), [['task-draft-9', undefined], ['task-draft-9', 'blocked']]);
  assert.ok(rows[1]!.patch.gate_reasons!.length > 0 && !rows[1]!.patch.gate_reasons!.includes('max_attempts'));
  assert.equal(s.sink.calls.some((c) => c.stage === 'factcheck'), false);
});
