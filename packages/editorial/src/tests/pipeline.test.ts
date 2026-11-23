import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { MOCK_SOURCE, mockResolver, mockWeb, COLLECT_ON } from '../../fixtures/mock-web.mock';
import { goodDraftOutput, MockGateway, mockOk } from '../../fixtures/mock-gateway.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog, MAX_ATTEMPTS, socialPack } from '../pipeline/stages';
import type { StageDeps } from '../pipeline/stages';
import { InMemoryQueue, createBullmqPipeline, jobOptions, makeProcessor } from '../pipeline/queue';
import type { BullmqLike } from '../pipeline/queue';
import type { ArticleJob, JobSpec, StageOutcome } from '../pipeline/jobs';
import { queueName, STAGES } from '../pipeline/jobs';
import { RefusingGateway } from '../gateway';
import { FlagDisabled } from '../flags';
import { SIGNATURE } from '../types';

// Garantia de "sem chamada real": qualquer fetch durante os testes derruba o teste.
const realFetch = globalThis.fetch;
globalThis.fetch = (() => { throw new Error('fetch real proibido nos testes do pipeline'); }) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });

const ev = (await new Collector(mockWeb(), { minSpacingMs: 0, now: () => new Date('2026-11-23T12:00:00Z'), resolver: mockResolver(), flags: COLLECT_ON })
  .collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;

const registry = new SourceRegistry([MOCK_SOURCE]);
const FLAGS = { 'editorialPipeline': true };
const baseJob = (over: Partial<ArticleJob> = {}): ArticleJob => ({ articleId: 'a1', editoria: 'pontos', evidences: [ev], attempt: 0, ...over });
const deps = (gateway: StageDeps['gateway'], flags: StageDeps['flags'] = FLAGS) =>
  ({ gateway, registry, audit: new InMemoryAuditLog(), flags, now: () => new Date('2026-11-23T12:00:00Z') }) satisfies StageDeps;

async function run(d: StageDeps, job: ArticleJob) {
  const q = new InMemoryQueue();
  const done: StageOutcome[] = [];
  const blockedList: StageOutcome[] = [];
  const proc = makeProcessor(d, q, { onDone: (o) => { done.push(o); }, onBlocked: (o) => { blockedList.push(o); } });
  await q.enqueue({ stage: 'triage', jobId: `${job.articleId}:triage:0`, data: job });
  await q.drain(proc);
  return { q, done, blockedList };
}

test('caminho feliz: triagem → contexto → redação → checagem → revisão => article.approved, assinatura institucional', async () => {
  const gw = new MockGateway(ev.id);
  const d = deps(gw);
  const { q, done, blockedList } = await run(d, baseJob());
  assert.equal(blockedList.length, 0);
  assert.deepEqual(q.processed.map((p) => p.spec.stage), ['triage', 'context', 'draft', 'factcheck', 'review']);
  const out = done[0]!;
  assert.equal(out.kind === 'done' && out.event, 'article.approved');
  const dr = out.kind === 'done' ? out.data.draft! : null;
  assert.equal(dr?.signature, SIGNATURE);
  assert.match(dr!.body, /Fontes:/);
  assert.equal(dr!.image.mode, 'none'); // sem base de direito => sem foto
  // todos os pedidos ao gateway: dados públicos apenas
  assert.ok(gw.requests.every((r) => r.dataClass === 'public'));
  assert.ok(d.audit.entries.some((e) => e.event === 'model_call' && e.promptVersion));
});

test('checagem exige provedor distinto do redator (excludeProviders enviado e resposta verificada)', async () => {
  const gw = new MockGateway(ev.id);
  await run(deps(gw), baseJob());
  const fc = gw.requests.find((r) => r.taskClass === 'factcheck')!;
  assert.deepEqual(fc.excludeProviders, ['deepseek']);

  const same = new MockGateway(ev.id, { factcheck: () => mockOk('deepseek', { verdicts: [] }) });
  const r = await run(deps(same), baseJob());
  assert.ok(r.blockedList[0]?.kind === 'blocked' && r.blockedList[0].blocked.blockers.includes('cross_provider_check_failed'));
});

test('checagem inconclusiva ou com claim sem veredito bloqueia (fail closed)', async () => {
  const inc = new MockGateway(ev.id, { factcheck: () => mockOk('anthropic', { verdicts: [{ claimId: 'c1', verdict: 'inconclusive' }, { claimId: 'c2', verdict: 'pass' }, { claimId: 'c3', verdict: 'pass' }, { claimId: 'c4', verdict: 'pass' }] }) });
  const r1 = await run(deps(inc), baseJob());
  assert.ok(r1.blockedList[0]?.kind === 'blocked' && r1.blockedList[0].blocked.blockers.includes('unsupported_claim'));
  const missing = new MockGateway(ev.id, { factcheck: () => mockOk('anthropic', { verdicts: [{ claimId: 'c1', verdict: 'pass' }] }) });
  const r2 = await run(deps(missing), baseJob());
  assert.equal(r2.done.length, 0);
});

test('redator inventa fala: barreira determinística bloqueia na 1ª redação, SEM nova tentativa (não gasta mais chamadas)', async () => {
  const gw = new MockGateway(ev.id, {
    draft: () => mockOk('deepseek', goodDraftOutput(ev.id, { body: 'A diretora disse: "frase totalmente inventada pelo modelo de teste".' })),
  });
  const r = await run(deps(gw), baseJob());
  assert.equal(gw.requests.filter((x) => x.taskClass === 'draft').length, 1, 'uma única chamada de redação');
  const b = r.blockedList[0]!;
  assert.ok(b.kind === 'blocked' && b.blocked.blockers.length > 0 && !b.blocked.blockers.includes('max_attempts'));
  assert.ok(b.kind === 'blocked' && b.blocked.stage === 'draft' && b.blocked.findings.length > 0);
  assert.equal(r.done.length, 0);
});

test('redator tenta assinar como pessoa: assinatura é sobrescrita; byline no corpo é barrada', async () => {
  const ok = new MockGateway(ev.id, { draft: () => mockOk('deepseek', { ...goodDraftOutput(ev.id), signature: 'Ana Repórter' }) });
  const r = await run(deps(ok), baseJob());
  assert.equal(r.done[0]?.kind === 'done' && r.done[0].data.draft?.signature, SIGNATURE);
  const by = new MockGateway(ev.id, { draft: () => mockOk('deepseek', goodDraftOutput(ev.id, { body: 'Por Ana Repórter\nTexto.' })) });
  assert.equal((await run(deps(by), baseJob())).done.length, 0);
});

test('triagem: duplicata, fonte sem termos aprovados e evidência suspeita bloqueiam sem chamar modelo', async () => {
  const gw = new MockGateway(ev.id);
  const dup = await run(deps(gw), baseJob({ duplicateOf: 'a0' }));
  assert.ok(dup.blockedList[0]?.kind === 'blocked' && dup.blockedList[0].blocked.blockers.includes('duplicate'));
  const pendingReg = new SourceRegistry([{ ...MOCK_SOURCE, termsStatus: 'pending' }]);
  const rr = await run({ ...deps(gw), registry: pendingReg }, baseJob());
  assert.ok(rr.blockedList[0]?.kind === 'blocked' && rr.blockedList[0].blocked.blockers.includes('rights_unknown'));
  const sus = await run(deps(gw), baseJob({ evidences: [{ ...ev, suspicious: true, suspiciousReasons: ['publish_command'] }] }));
  assert.ok(sus.blockedList[0]?.kind === 'blocked' && sus.blockedList[0].blocked.blockers.includes('suspicious_evidence'));
  assert.equal(gw.requests.length, 0);
});

test('gateway recusa (orçamento/sem modelo habilitado) => bloqueio budget_blocked, nada publicado', async () => {
  const r = await run(deps(new RefusingGateway()), baseJob());
  assert.ok(r.blockedList[0]?.kind === 'blocked' && r.blockedList[0].blocked.blockers.includes('budget_blocked'));
  const exhausted = new MockGateway(ev.id, { draft: () => ({ ok: false, refusal: 'budget_exhausted' }) });
  const r2 = await run(deps(exhausted), baseJob());
  assert.ok(r2.blockedList[0]?.kind === 'blocked' && r2.blockedList[0].blocked.blockers.includes('budget_blocked'));
});

test('saída malformada do modelo é rejeitada (invalid_model_output)', async () => {
  const gw = new MockGateway(ev.id, { triage: () => mockOk('deepseek', 'oi') });
  const r = await run(deps(gw), baseJob());
  assert.ok(r.blockedList[0]?.kind === 'blocked' && r.blockedList[0].blocked.blockers.includes('invalid_model_output'));
});

test('flag desligada (padrão): pipeline recusa executar', async () => {
  await assert.rejects(run(deps(new MockGateway(ev.id), {}), baseJob()), FlagDisabled);
});

test('imagem: com base de direito registrada, a imagem da fonte entra com crédito; sem base, sem foto', async () => {
  const withBasis = { ...MOCK_SOURCE, imageRights: { kind: 'authorization' as const, reference: 'AUT-MOCK-1', registeredAt: '2026-11-22T00:00:00Z', validatedBy: 'root' } };
  const gw = new MockGateway(ev.id, { draft: () => mockOk('deepseek', goodDraftOutput(ev.id, { imageCandidate: { url: 'https://ri.mock.example/i.jpg', credit: 'MOCK Foto', creditLink: 'https://ri.mock.example/' } })) });
  const a = await run({ ...deps(gw), registry: new SourceRegistry([withBasis]) }, baseJob());
  assert.equal(a.done[0]?.kind === 'done' && a.done[0].data.draft?.image.mode, 'source_image');
  const b = await run(deps(gw), baseJob());
  assert.equal(b.done[0]?.kind === 'done' && b.done[0].data.draft?.image.mode, 'none');
});

test('pacote social: só após publicação; sem menções; UTM; sem foto => blocker no_image; instagram ausente com flag desligada', async () => {
  const gw = new MockGateway(ev.id);
  const d = deps(gw);
  const { done } = await run(d, baseJob());
  const approved = (done[0] as Extract<StageOutcome, { kind: 'done' }>).data;
  const early = await makeProcessor(d, new InMemoryQueue())({ stage: 'social_pack', jobId: 'x', data: approved });
  assert.ok(early.kind === 'blocked' && early.blocked.blockers.includes('approval_missing'));
  const out = await socialPack(d, approved, { url: 'https://loyaltynews.example/materia/a1' });
  assert.ok(out.kind === 'done' && out.pack);
  const pack = out.pack!;
  assert.match(pack.linkedin.text, /utm_source=linkedin&utm_medium=social&utm_campaign=materia-a1/);
  assert.deepEqual(pack.mentions, []);
  assert.equal(pack.instagram, undefined);
  assert.deepEqual(pack.blockers, ['no_image']);
  // Instagram só com flag explícita
  const ig = await socialPack({ ...d, flags: { ...FLAGS, 'instagram': true } }, approved, { url: 'https://loyaltynews.example/materia/a1' });
  assert.ok(ig.kind === 'done' && ig.pack?.instagram);
});

test('pacote social: número ou menção inventados no post são barrados/neutralizados', async () => {
  const gw0 = new MockGateway(ev.id);
  const { done } = await run(deps(gw0), baseJob());
  const approved = (done[0] as Extract<StageOutcome, { kind: 'done' }>).data;
  const badNum = new MockGateway(ev.id, { social_pack: () => mockOk('deepseek', { linkedin: 'Alta de 87% nas vendas!' }) });
  const r = await socialPack(deps(badNum), approved, { url: 'https://x.example/a' });
  assert.equal(r.kind, 'blocked');
  const men = new MockGateway(ev.id, { social_pack: () => mockOk('deepseek', { linkedin: 'Parceria com @varejistabeta anunciada.' }) });
  const r2 = await socialPack(deps(men), approved, { url: 'https://x.example/a' });
  assert.ok(r2.kind === 'done' && !r2.pack!.linkedin.text.includes('@'));
});

test('fila em memória: idempotência por jobId; job duplicado não reexecuta', async () => {
  const q = new InMemoryQueue();
  const spec: JobSpec = { stage: 'triage', jobId: 'dup', data: baseJob() };
  await q.enqueue(spec); await q.enqueue(spec);
  let n = 0;
  await q.drain(async () => { n++; return { kind: 'blocked', blocked: { articleId: 'a1', stage: 'triage', blockers: ['duplicate'], findings: [] } }; });
  assert.equal(n, 1);
});

test('BullMQ: uma fila por estágio, jobId idempotente, tentativas e backoff (adaptador testado com classes falsas, sem Redis)', async () => {
  const added: Array<{ queue: string; name: string; opts: Record<string, unknown> }> = [];
  const workers: Array<{ name: string; proc: (j: { data: unknown }) => Promise<unknown> }> = [];
  const fake: BullmqLike = {
    Queue: class { n: string; constructor(n: string) { this.n = n; } async add(name: string, _d: unknown, opts?: Record<string, unknown>) { added.push({ queue: this.n, name, opts: opts ?? {} }); } },
    Worker: class { constructor(name: string, proc: (j: { data: unknown }) => Promise<unknown>) { workers.push({ name, proc }); } async close() {} },
  };
  const p = createBullmqPipeline(fake, { host: 'redis.mock' }, deps(new MockGateway(ev.id)));
  assert.deepEqual(workers.map((w) => w.name), STAGES.map(queueName));
  await p.queue.enqueue({ stage: 'draft', jobId: 'a1:draft:0', data: baseJob() });
  assert.equal(added[0]?.queue, 'editorial-draft');
  assert.equal(added[0]?.opts['jobId'], 'a1:draft:0');
  assert.equal(added[0]?.opts['attempts'], 3);
  assert.deepEqual(jobOptions({ stage: 'triage', jobId: 'z', data: baseJob() })['backoff'], { type: 'exponential', delay: 30000 });
  // worker de triagem processa e encadeia o próximo estágio na fila certa
  const res = await workers[0]!.proc({ data: { stage: 'triage', jobId: 'a1:triage:0', data: baseJob() } });
  assert.deepEqual(res, { kind: 'next' });
  assert.equal(added.at(-1)?.queue, 'editorial-context');
  await p.close();
});
