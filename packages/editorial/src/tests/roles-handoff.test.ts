import { test, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver } from '../../fixtures/mock-web.mock';
import { MockGateway, mockOk } from '../../fixtures/mock-gateway.mock';
import { mockWebRoles, passAll, rolesDraftOutput } from '../../fixtures/mock-roles.mock';
import { consumeArticleMock, resetMockConsumer } from '../../fixtures/mock-intelligence-consumer.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog, runStage } from '../pipeline/stages';
import type { PublishedInfo, StageDeps } from '../pipeline/stages';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { ArticleJob, StageOutcome } from '../pipeline/jobs';
import type { Evidence } from '../types';
import { InMemoryEditorialStore, applyOutcome } from '../api/store';
import { INTELLIGENCE_QUEUE, applyPublication } from '../api/publication';
import { draftContentSha256, jobFromRecord, toPublishableContent, toPublishedArticle } from '../intelligence/published';
import { publishedContentSha256 } from '@ln/contracts/hash';
import { extractRoleMentionsDeterministic, explicitDates, minimizeToOrganizations, validateMention } from '../intelligence/roles';
import type { IntelligenceHandoff } from '../intelligence/types';

const NOW = new Date('2026-11-24T13:00:00Z');
const URL_PUB = 'https://loyaltynews.example/materia/a1';
let ev: Evidence;
beforeAll(async () => {
  ev = (await new Collector(mockWebRoles(), { minSpacingMs: 0, now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/nomeacoes')).evidence!;
});

const ROLES_PERSONS = { editorialPipeline: true, intelligencePessoas: true } as const;
const ROLES_ORGS = { editorialPipeline: true } as const;

/** Gateway MOCK: redator parafraseia as nomeações; o modelo de cargos propõe uma mistura de válidas e inválidas. */
function gateway(rolesOut?: () => unknown, extraSentence = '') {
  return new MockGateway(ev.id, {
    draft: () => mockOk('deepseek', rolesDraftOutput(ev.id, extraSentence)),
    factcheck: () => mockOk('anthropic', passAll(['c1', 'c2', 'c3'])),
    roles: () => mockOk('deepseek', rolesOut ? rolesOut() : { mentions: [] }),
  });
}

async function approve(gw: MockGateway, flags: StageDeps['flags']) {
  const store = new InMemoryEditorialStore();
  const deps: StageDeps = { gateway: gw, registry: new SourceRegistry([MOCK_SOURCE]), audit: new InMemoryAuditLog(), flags, now: () => NOW };
  const q = new InMemoryQueue();
  await q.enqueue({ stage: 'triage', jobId: 'a1:triage:0', data: { articleId: 'a1', editoria: 'mercado', evidences: [ev], attempt: 0 } });
  await q.drain(makeProcessor(deps, q));
  for (const { spec, outcome } of q.processed) await applyOutcome(store, spec.data, outcome, NOW.toISOString());
  return { store, deps, last: q.processed.at(-1)!.outcome as StageOutcome };
}

async function publish(store: InMemoryEditorialStore) {
  const res = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-MOCK-1', url: URL_PUB, publishedAt: NOW.toISOString(), isMock: true });
  assert.ok(res.ok, res.ok ? '' : res.message);
  return { outbox: { items: await store.listOutbox() }, res };
}

const handoffOf = (o: StageOutcome): IntelligenceHandoff => { assert.ok(o.kind === 'done' && o.handoff, JSON.stringify(o)); return o.handoff; };

// ---------- extração determinística ----------
test('regras: nomeação, saída e cargo atual — com data só quando há uma data inequívoca; sem anúncio não há `announced`', () => {
  const t = 'Maria Teste foi nomeada diretora de Marketing da Empresa Fictícia Alfa, com início em 1º de dezembro de 2026. João Exemplo sai do cargo de diretor comercial na Empresa Fictícia Alfa. Segundo Ana Cargo, gerente de Dados da Empresa Fictícia Beta, o plano segue.';
  const ms = extractRoleMentionsDeterministic(t);
  assert.equal(ms.length, 3);
  const [a, b, c] = ms;
  assert.deepEqual([a!.personName, a!.title, a!.orgName, a!.kind, a!.announced, a!.effectiveDate], ['Maria Teste', 'Diretora de Marketing', 'Empresa Fictícia Alfa', 'present', true, '2026-12-01']);
  assert.deepEqual([b!.personName, b!.kind, b!.announced, b!.effectiveDate], ['João Exemplo', 'left', true, undefined]);
  assert.deepEqual([c!.personName, c!.title, c!.kind, c!.announced], ['Ana Cargo', 'Gerente de Dados', 'present', undefined]);
  assert.ok(ms.every((m) => t.includes(m.excerpt) && m.excerpt.length <= 500));
  assert.deepEqual(extractRoleMentionsDeterministic('O mercado de fidelidade cresceu em novembro. Nada sobre cargos aqui.'), []);
  assert.deepEqual(explicitDates('em 15/12/2026 e também em 16/12/2026'), ['2026-12-15', '2026-12-16']);
  assert.deepEqual(explicitDates('em 31/02/2026'), []); // data inexistente não vira data
});

test('validação: trecho literal, nome/empresa/cargo no trecho e nas fontes; anúncio e data só com base; chaves extras removidas', () => {
  const text = 'Maria Teste foi nomeada diretora de Marketing da Empresa Fictícia Alfa, com início em 1º de dezembro de 2026. Pedro Amostra coordena Parcerias na Empresa Fictícia Alfa.';
  const src = [ev.text];
  const m1 = { personName: 'Maria Teste', orgName: 'Empresa Fictícia Alfa', title: 'diretora de Marketing', kind: 'present', announced: true, effectiveDate: '2026-12-01', excerpt: text.split('. ')[0] + '.' };
  const ok = validateMention({ ...m1, email: 'x@mock.example', phone: '1' }, text, src);
  assert.ok(ok.ok);
  assert.ok(ok.ok && !('email' in ok.mention) && !('phone' in ok.mention));
  const why = (m: unknown) => { const v = validateMention(m, text, src); return v.ok ? 'ok' : v.drop.reason; };
  assert.equal(why({ ...m1, excerpt: 'Maria Teste é diretora de Marketing da Empresa Fictícia Alfa.' }), 'excerpt_not_literal');
  assert.equal(why({ ...m1, personName: 'Maria Inventada' }), 'name_not_in_excerpt');
  assert.equal(why({ ...m1, orgName: 'Outra Empresa' }), 'org_not_in_excerpt');
  assert.equal(why({ ...m1, title: 'presidente' }), 'title_not_in_excerpt');
  assert.equal(why({ ...m1, effectiveDate: '2026-12-02' }), 'date_not_in_excerpt');
  const pedro = { personName: 'Pedro Amostra', orgName: 'Empresa Fictícia Alfa', title: 'Parcerias', kind: 'present', excerpt: 'Pedro Amostra coordena Parcerias na Empresa Fictícia Alfa.' };
  assert.equal(why(pedro), 'ok');
  assert.equal(why({ ...pedro, announced: true }), 'announcement_unsupported');
  assert.equal(why({ ...pedro, publicProfileUrl: 'https://perfil.example/pedro' }), 'profile_url_not_in_text');
  assert.equal(why({ ...pedro, publicProfileUrl: 'javascript:alert(1)' }), 'profile_url_not_public');
  assert.equal(why({ ...pedro, personName: 'pedro' }), 'bad_shape');
  assert.equal(why('texto'), 'bad_shape');
  assert.equal(validateMention(pedro, text, ['Texto de outra fonte sem esses nomes']).ok, false); // não consta na fonte primária
});

// ---------- ponta a ponta ----------
test('E2E (flag ligada): coleta → pipeline → aprovada → publicada (outbox) → cargos → consumidor MOCK', async () => {
  resetMockConsumer();
  const longSentence = ' Ana Hipótese lidera Estratégia na Empresa Fictícia Alfa.'; // nome que a fonte NÃO sustenta
  const gw = gateway(() => ({
    mentions: [
      { personName: 'Pedro Amostra', orgName: 'Empresa Fictícia Alfa', title: 'Parcerias', kind: 'present', announced: true, excerpt: 'Pedro Amostra coordena Parcerias na Empresa Fictícia Alfa.' }, // anúncio sem marca => descartada
      { personName: 'Pedro Amostra', orgName: 'Empresa Fictícia Alfa', title: 'Parcerias', kind: 'present', email: 'pedro@mock.example', excerpt: 'Pedro Amostra coordena Parcerias na Empresa Fictícia Alfa.' }, // válida; email removido
      { personName: 'Fulano Inventado', orgName: 'Empresa Fictícia Alfa', title: 'diretor', kind: 'present', excerpt: 'Fulano Inventado é diretor da Empresa Fictícia Alfa.' }, // inventada
      { personName: 'Ana Hipótese', orgName: 'Empresa Fictícia Alfa', title: 'Estratégia', kind: 'present', excerpt: 'Ana Hipótese lidera Estratégia na Empresa Fictícia Alfa.' }, // está no texto, não na fonte
      { personName: 'Maria Teste', orgName: 'Empresa Fictícia Alfa', title: 'diretora de Marketing', kind: 'present', announced: true, excerpt: 'Maria Teste foi nomeada diretora de Marketing da Empresa Fictícia Alfa, com início em 1º de dezembro de 2026.' }, // duplicata da regra
    ],
  }), longSentence);
  const { store, deps, last } = await approve(gw, ROLES_PERSONS);
  assert.equal(last.kind === 'done' && last.event, 'article.approved');
  assert.equal((await store.getArticle('a1'))?.status, 'aprovado');

  // antes de publicar não há PublishedArticle nem extração
  assert.equal(toPublishedArticle((await store.getArticle('a1'))!).ok, false);
  const early = await runStage(deps, { stage: 'roles', jobId: 'x', data: jobFromRecord((await store.getArticle('a1'))!) }, { url: URL_PUB });
  assert.ok(early.kind === 'blocked' && early.blocked.blockers.includes('approval_missing'), 'aprovada-sem-publicar: nunca extrai (rascunho não conta)');

  const { outbox, res } = await publish(store);
  assert.equal(res.ok && res.outbox, 'enqueued');
  assert.equal(outbox.items.length, 1);
  assert.equal(outbox.items[0]?.queue, INTELLIGENCE_QUEUE);
  assert.equal(outbox.items[0]?.refId, 'a1');
  const rec = (await store.getArticle('a1'))!;
  assert.equal(rec.status, 'publicado');
  const pa = toPublishedArticle(rec);
  assert.ok(pa.ok);
  assert.equal(pa.ok && pa.article.status, 'published');
  assert.equal(pa.ok && pa.article.contentSha256, draftContentSha256(rec.draft!));
  assert.ok(pa.ok && !('text' in pa.article) && !('headline' in pa.article), 'evento por referência: sem texto por padrão');

  const out = await runStage(deps, { stage: 'roles', jobId: 'a1:roles:0', data: jobFromRecord(rec) }, { url: URL_PUB, publishedAt: rec.publication!.publishedAt, contentSha256: rec.publication!.contentSha256, isMock: true });
  const h = handoffOf(out);
  assert.equal(h.personsIncluded, true);
  assert.deepEqual(h.mentions.map((m) => `${m.personName}|${m.kind}`), ['Maria Teste|present', 'João Exemplo|left', 'Pedro Amostra|present']);
  assert.deepEqual(h.origins, ['rule', 'rule', 'model']);
  const reasons = h.dropped.map((d) => d.reason).sort();
  assert.deepEqual(reasons, ['announcement_unsupported', 'duplicate', 'excerpt_not_literal', 'not_in_source_evidence']);
  for (const m of h.mentions) {
    assert.ok(h.article.text!.includes(m.excerpt), 'trecho literal da matéria');
    assert.ok(Object.keys(m).every((k) => ['personName', 'orgName', 'title', 'kind', 'announced', 'effectiveDate', 'excerpt', 'publicProfileUrl'].includes(k)));
  }
  assert.equal(h.mentions[0]?.effectiveDate, '2026-12-01');
  assert.equal(h.mentions[1]?.effectiveDate, undefined);
  assert.equal(h.mentions[2]?.announced, undefined, 'sem anúncio na matéria => sem announced');
  assert.equal(h.article.isMock, true);
  assert.ok(!JSON.stringify(h).includes('pedro@mock.example'));

  // o consumidor (contrato replicado) aceita o pacote e grava cargos
  const c = consumeArticleMock({ article: h.article, mentions: h.mentions }, { personIngestion: true });
  assert.equal(c.status, 'ingested');
  assert.equal(c.status === 'ingested' && c.observations.length, 3);
  // idempotência: o mesmo URL + hash não é reingerido
  assert.equal(consumeArticleMock({ article: h.article, mentions: h.mentions }, { personIngestion: true }).status, 'skipped');
  // o modelo foi chamado pelo gateway, com dado público e workflow WF06
  const rr = gw.requests.find((r) => r.taskClass === 'roles')!;
  assert.equal(rr.workflow, 'WF06');
  assert.equal(rr.dataClass, 'public');
});

test('E2E (flag intelligencePessoas DESLIGADA, padrão): só organizações, nenhum modelo chamado e nenhum nome de pessoa no pacote', async () => {
  resetMockConsumer();
  const gw = gateway(() => ({ mentions: [] }));
  const { store, deps } = await approve(gw, ROLES_ORGS);
  await publish(store);
  const rec = (await store.getArticle('a1'))!;
  const out = await runStage(deps, { stage: 'roles', jobId: 'a1:roles:0', data: jobFromRecord(rec) }, { url: URL_PUB, publishedAt: rec.publication!.publishedAt, contentSha256: rec.publication!.contentSha256, isMock: true });
  const h = handoffOf(out);
  assert.equal(h.personsIncluded, false);
  assert.equal(gw.requests.filter((r) => r.taskClass === 'roles').length, 0, 'sem chamada de modelo para cargos');
  assert.ok(h.mentions.length >= 2);
  const blob = JSON.stringify(h);
  for (const nome of ['Maria Teste', 'João Exemplo', 'Pedro Amostra']) assert.ok(!blob.includes(nome), `${nome} vazou no pacote`);
  assert.ok(!('headline' in h.article) && !('text' in h.article), 'sem título/texto (poderiam conter nomes)');
  assert.ok(h.mentions.every((m) => m.personName === '' && m.excerpt.includes('[pessoa omitida]')));
  assert.ok(h.dropped.every((d) => !('personName' in d)));
  const c = consumeArticleMock({ article: h.article, mentions: h.mentions }, { personIngestion: false });
  assert.equal(c.status, 'organizations_only');
  assert.deepEqual(c.status === 'organizations_only' && c.organizations, ['Empresa Fictícia Alfa']);
  assert.ok(!(c.status === 'organizations_only' && c.storedText.includes('Maria Teste')), 'o que o consumidor guardaria não tem nome de pessoa');
  assert.ok(!(c.status === 'organizations_only' && c.storedText.includes('João Exemplo')));
});

test('nunca extrair de rascunho nem de texto trocado: hash divergente, sem recibo, sem URL pública e flag do pipeline desligada bloqueiam', async () => {
  const { store, deps } = await approve(gateway(), ROLES_PERSONS);
  const approvedRec = (await store.getArticle('a1'))!;
  // aprovada mas não publicada: jobFromRecord não marca aprovado
  assert.equal(jobFromRecord(approvedRec).approved, false);
  await publish(store);
  const rec = (await store.getArticle('a1'))!;
  const job: ArticleJob = jobFromRecord(rec);
  assert.equal(job.approved, true);
  const run = (data: ArticleJob, pub: PublishedInfo) => runStage(deps, { stage: 'roles', jobId: 'r', data }, pub);
  const stale = await run(job, { url: URL_PUB, contentSha256: 'f'.repeat(64) });
  assert.ok(stale.kind === 'blocked' && stale.blocked.blockers.includes('stale_approval'));
  const noUrl = await run(job, { url: 'ftp://x' });
  assert.ok(noUrl.kind === 'blocked' && noUrl.blocked.blockers.includes('not_published'));
  const sus = await run({ ...job, evidences: job.evidences.map((e) => ({ ...e, suspicious: true, suspiciousReasons: ['publish_command'] })) }, { url: URL_PUB });
  assert.ok(sus.kind === 'blocked' && sus.blocked.blockers.includes('suspicious_evidence'));
  const noPub = await runStage(deps, { stage: 'roles', jobId: 'r', data: job });
  assert.ok(noPub.kind === 'blocked' && noPub.blocked.blockers.includes('not_published'));
  await assert.rejects(runStage({ ...deps, flags: {} }, { stage: 'roles', jobId: 'r', data: job }, { url: URL_PUB }), /flag desligada: editorialPipeline/);
});

test('modelo: recusa do gateway (orçamento) bloqueia; saída malformada é rejeitada; deterministas continuam válidas sem modelo', async () => {
  const { store, deps } = await approve(gateway(), ROLES_PERSONS);
  await publish(store);
  const rec = (await store.getArticle('a1'))!;
  const spec = { stage: 'roles' as const, jobId: 'r', data: jobFromRecord(rec) };
  const pub = { url: URL_PUB, publishedAt: rec.publication!.publishedAt };
  const refused = await runStage({ ...deps, gateway: new MockGateway(ev.id, { roles: () => ({ ok: false, refusal: 'budget_exhausted' }) }) }, spec, pub);
  assert.ok(refused.kind === 'blocked' && refused.blocked.blockers.includes('budget_blocked'));
  const malformed = await runStage({ ...deps, gateway: new MockGateway(ev.id, { roles: () => mockOk('deepseek', 'oi') }) }, spec, pub);
  assert.ok(malformed.kind === 'blocked' && malformed.blocked.blockers.includes('invalid_model_output'));
  const none = await runStage({ ...deps, gateway: new MockGateway(ev.id, { roles: () => mockOk('deepseek', { mentions: [] }) }) }, spec, pub);
  assert.equal(handoffOf(none).mentions.length, 3 - 1 /* Pedro só vem do modelo */);
});

// ---------- publicação (outbox) ----------
test('applyPublication: só matéria aprovada; gate refeito; idempotente pelo recibo; outbox deduplica; entrada inválida recusada', async () => {
  const { store } = await approve(gateway(), ROLES_PERSONS);
  const base = { articleId: 'a1', receiptId: 'rcpt-1', url: URL_PUB, publishedAt: NOW.toISOString() };
  assert.equal((await applyPublication(store, { ...base, receiptId: ' ' })).ok, false);
  assert.equal((await applyPublication(store, { ...base, url: 'ftp://x' })).ok, false);
  const nf = await applyPublication(store, { ...base, articleId: 'nao-existe' });
  assert.ok(!nf.ok && nf.code === 'not_found');
  // adulteração depois da aprovação: o gate refeito recusa
  const rec = (await store.getArticle('a1'))!;
  await store.putArticle({ ...rec, draft: { ...rec.draft!, body: rec.draft!.body.replace('\n\nFontes:\n', '\nA alta foi de 87%.\n\nFontes:\n') } });
  const tampered = await applyPublication(store, base);
  assert.ok(!tampered.ok && tampered.code === 'gate_failed');
  assert.equal((await store.listOutbox()).length, 0);
  assert.equal((await store.getArticle('a1'))?.status, 'aprovado');
  await store.putArticle(rec); // restaura
  const first = await applyPublication(store, base);
  assert.ok(first.ok && !first.alreadyPublished && first.outbox === 'enqueued');
  const again = await applyPublication(store, base);
  assert.ok(again.ok && again.alreadyPublished && again.outbox === 'duplicate');
  assert.equal((await store.listOutbox()).length, 1);
  // outro recibo para matéria já publicada não republica
  const other = await applyPublication(store, { ...base, receiptId: 'rcpt-2' });
  assert.ok(!other.ok && other.code === 'not_approved');
  assert.deepEqual((await store.listAudit()).filter((a) => a.action === 'article.published').length, 1);
});

test('toPublishedArticle recusa texto alterado depois da publicação (hash) e matéria sem recibo', async () => {
  const { store } = await approve(gateway(), ROLES_PERSONS);
  await publish(store);
  const rec = (await store.getArticle('a1'))!;
  assert.equal(toPublishedArticle({ ...rec, draft: { ...rec.draft!, body: `${rec.draft!.body} extra` } }).ok, false);
  const { publication: _p, ...noPub } = rec;
  void _p;
  const r = toPublishedArticle(noPub);
  assert.ok(!r.ok && r.reason === 'no_publication_record');
  const withText = toPublishedArticle(rec, { withText: true });
  assert.ok(withText.ok && withText.article.text && !withText.article.text.includes('Fontes:'));
});

test('minimizeToOrganizations remove o nome de todas as pessoas do lote em todos os trechos', () => {
  const ms = minimizeToOrganizations([
    { personName: 'Maria Teste', orgName: 'Alfa', title: 'Diretora', kind: 'present', excerpt: 'Maria Teste assume; João Exemplo sai.' },
    { personName: 'João Exemplo', orgName: 'Alfa', title: 'Diretor', kind: 'left', excerpt: 'João Exemplo sai.' },
  ]);
  assert.ok(ms.every((m) => !/Maria Teste|João Exemplo/.test(JSON.stringify(m))));
  assert.equal(ms[0]?.excerpt, '[pessoa omitida] assume; [pessoa omitida] sai.');
});

// ---------- atomicidade da publicação (bloqueio do QA 2 no 941ee41) ----------
test('publicação atômica: falha injetada em QUALQUER passo não deixa matéria publicada sem auditoria/outbox; a repetição completa tudo uma vez', async () => {
  for (const step of ['after_article', 'after_audit', 'after_outbox'] as const) {
    const { store } = await approve(gateway(), ROLES_PERSONS);
    const base = { articleId: 'a1', receiptId: 'rcpt-A', url: URL_PUB, publishedAt: NOW.toISOString(), isMock: true };
    store.armFault(step);
    await assert.rejects(applyPublication(store, base), /falha injetada/);
    // nada parcial: continua aprovada, sem recibo, sem auditoria, sem outbox
    const mid = (await store.getArticle('a1'))!;
    assert.equal(mid.status, 'aprovado', step);
    assert.equal(mid.publication, undefined, step);
    assert.equal((await store.listAudit()).filter((a) => a.action === 'article.published').length, 0, step);
    assert.equal((await store.listOutbox()).length, 0, step);
    assert.equal(toPublishedArticle(mid).ok, false);
    // retry: completa tudo, uma única vez
    const ok = await applyPublication(store, base);
    assert.ok(ok.ok && ok.outbox === 'enqueued' && !ok.alreadyPublished, step);
    assert.equal((await store.listAudit()).filter((a) => a.action === 'article.published').length, 1, step);
    assert.equal((await store.listOutbox()).length, 1, step);
    assert.equal((await store.getArticle('a1'))?.status, 'publicado');
    // e repetir de novo não duplica nada
    const again = await applyPublication(store, base);
    assert.ok(again.ok && again.alreadyPublished && again.outbox === 'duplicate', step);
    assert.equal((await store.listAudit()).filter((a) => a.action === 'article.published').length, 1, step);
    assert.equal((await store.listOutbox()).length, 1, step);
  }
});

test('publicação atômica: publicação antiga SEM auditoria/outbox (estado legado) é completada pelo retry idempotente', async () => {
  const { store } = await approve(gateway(), ROLES_PERSONS);
  const rec = (await store.getArticle('a1'))!;
  // estado legado: matéria já marcada publicada com recibo, mas sem auditoria e sem outbox
  await store.putArticle({ ...rec, status: 'publicado', publication: { receiptId: 'rcpt-L', url: URL_PUB, publishedAt: NOW.toISOString(), contentSha256: draftContentSha256(rec.draft!) } });
  assert.equal((await store.listAudit()).length, 0);
  assert.equal((await store.listOutbox()).length, 0);
  const fixed = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-L', url: URL_PUB, publishedAt: NOW.toISOString() });
  assert.ok(fixed.ok && fixed.alreadyPublished === true && fixed.outbox === 'enqueued', 'já estava publicada, mas o retry completou auditoria e outbox');
  assert.equal((await store.listAudit()).length, 1);
  assert.equal((await store.listOutbox()).length, 1);
  const twice = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-L', url: URL_PUB, publishedAt: NOW.toISOString() });
  assert.ok(twice.ok && twice.outbox === 'duplicate');
  assert.equal((await store.listAudit()).length, 1);
});

test('publicação atômica: duas publicações concorrentes da mesma matéria geram 1 auditoria e 1 outbox', async () => {
  const { store } = await approve(gateway(), ROLES_PERSONS);
  const base = { articleId: 'a1', receiptId: 'rcpt-C', url: URL_PUB, publishedAt: NOW.toISOString() };
  const rs = await Promise.all([applyPublication(store, base), applyPublication(store, base), applyPublication(store, base)]);
  assert.ok(rs.every((r) => r.ok));
  assert.equal(rs.filter((r) => r.ok && r.outbox === 'enqueued').length, 1);
  assert.equal((await store.listAudit()).length, 1);
  assert.equal((await store.listOutbox()).length, 1);
});

// ---------- ADR-017: hash do recibo = publishedContentSha256 do RASCUNHO aprovado; id único ----------
test('ADR-017: o hash é publishedContentSha256 de @ln/contracts sobre o rascunho; recibo, outbox e publication usam o mesmo valor', async () => {
  const { store } = await approve(gateway(), ROLES_PERSONS);
  const rec = (await store.getArticle('a1'))!;
  const c = toPublishableContent(rec.draft!);
  assert.equal(c.titulo, rec.draft!.headline);
  assert.equal(c.tipoConteudo, 'noticia');
  assert.equal(c.patrocinado, false);
  assert.equal(c.classeDeDado, 'public');
  assert.deepEqual([...c.fontes], rec.draft!.evidenceIds);
  const sha = publishedContentSha256(c);
  assert.equal(draftContentSha256(rec.draft!), sha);
  const res = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-H', url: URL_PUB, publishedAt: NOW.toISOString(), expectedContentSha256: sha });
  assert.ok(res.ok);
  assert.equal((await store.getArticle('a1'))?.publication?.contentSha256, sha);
  assert.equal((await store.listOutbox())[0]?.idempotencyKey, `article.published:a1:${sha}`);
  const pa = toPublishedArticle((await store.getArticle('a1'))!);
  assert.ok(pa.ok && pa.article.contentSha256 === sha && pa.article.id === 'a1', 'PublishedArticle.id é o id único da matéria');
});

test('ADR-017: trocar manchete, imagem, fontes ou corpo depois da aprovação invalida o recibo (o hash antigo só do corpo não pegaria)', async () => {
  const { store, deps } = await approve(gateway(), ROLES_PERSONS);
  const rec = (await store.getArticle('a1'))!;
  const approvedSha = draftContentSha256(rec.draft!);
  const variants: Array<[string, typeof rec.draft]> = [
    ['manchete', { ...rec.draft!, headline: 'MOCK: outra manchete' }],
    ['imagem', { ...rec.draft!, image: { mode: 'source_image', sourceId: 'mock-ri', url: 'https://ri.mock.example/i.jpg', credit: 'c', creditLink: 'https://ri.mock.example', basis: null } }],
    ['fontes', { ...rec.draft!, evidenceIds: [...rec.draft!.evidenceIds, 'ev_outra'] }],
    ['editoria', { ...rec.draft!, editoria: 'regulacao' }],
    ['corpo', { ...rec.draft!, body: `${rec.draft!.body} ` }],
  ];
  for (const [what, d] of variants) {
    assert.notEqual(draftContentSha256(d!), approvedSha, `${what} deve mudar o hash`);
    // publicação com recibo emitido sobre o rascunho aprovado, mas o rascunho foi trocado depois: recusada
    await store.putArticle({ ...rec, draft: d! });
    const r = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-X', url: URL_PUB, publishedAt: NOW.toISOString(), expectedContentSha256: approvedSha });
    assert.ok(!r.ok && (r.code === 'receipt_stale' || r.code === 'gate_failed'), `${what}: ${JSON.stringify(r)}`);
    assert.equal((await store.getArticle('a1'))?.status, 'aprovado');
    assert.equal((await store.listOutbox()).length, 0);
  }
  // manchete/editoria não são pegas pelo gate editorial: é o hash do recibo que as barra
  await store.putArticle({ ...rec, draft: variants[0]![1]! });
  const stale = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-X', url: URL_PUB, publishedAt: NOW.toISOString(), expectedContentSha256: approvedSha });
  assert.ok(!stale.ok && stale.code === 'receipt_stale');
  await store.putArticle(rec);
  assert.ok((await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-X', url: URL_PUB, publishedAt: NOW.toISOString(), expectedContentSha256: approvedSha })).ok);
  // depois de publicada, trocar a manchete faz o PublishedArticle e o estágio roles recusarem (hash do recibo não bate)
  const pub = (await store.getArticle('a1'))!;
  await store.putArticle({ ...pub, draft: { ...pub.draft!, headline: 'MOCK: manchete trocada depois' } });
  const mism = toPublishedArticle((await store.getArticle('a1'))!);
  assert.ok(!mism.ok && mism.reason === 'content_mismatch');
  const out = await runStage(deps, { stage: 'roles', jobId: 'r', data: jobFromRecord((await store.getArticle('a1'))!) }, { url: URL_PUB, contentSha256: pub.publication!.contentSha256 });
  assert.ok(out.kind === 'blocked' && out.blocked.blockers.includes('stale_approval'));
});

test('ADR-017: o id é um só e não muda — o registro e o PublishedArticle usam o articleId da criação do rascunho', async () => {
  const { store } = await approve(gateway(), ROLES_PERSONS);
  const rec = (await store.getArticle('a1'))!;
  assert.equal(rec.articleId, 'a1');
  // applyOutcome (hooks do worker) nunca troca o id: reaplicar resultados mantém a chave e não duplica o registro
  const other = new InMemoryEditorialStore();
  const job = { articleId: 'zz', editoria: 'pontos' as const, evidences: [ev], attempt: 0 };
  await applyOutcome(other, job, { kind: 'next', next: { stage: 'context', jobId: 'zz:context:0', data: job } }, NOW.toISOString());
  const again = await applyOutcome(other, { ...job, editoria: 'regulacao' as const }, { kind: 'blocked', blocked: { articleId: 'zz', stage: 'triage', blockers: ['duplicate'], findings: [] } }, NOW.toISOString());
  assert.equal(again.articleId, 'zz');
  assert.deepEqual((await other.listArticles()).map((x) => x.articleId), ['zz']);
  // commitPublication grava sob o id do próprio registro (chave = article.articleId); não existe operação de renomear
  await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-I', url: URL_PUB, publishedAt: NOW.toISOString() });
  assert.deepEqual((await store.listArticles()).map((a) => a.articleId), ['a1']);
  assert.equal((await store.listOutbox())[0]?.refId, 'a1');
});
