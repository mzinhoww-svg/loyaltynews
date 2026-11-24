import { test, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { Article, ImageRights } from '@ln/contracts';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver } from '../../fixtures/mock-web.mock';
import { MockGateway, mockOk } from '../../fixtures/mock-gateway.mock';
import { mockWebRoles, passAll, rolesDraftOutput } from '../../fixtures/mock-roles.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog, draft as draftStage } from '../pipeline/stages';
import type { StageDeps } from '../pipeline/stages';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { StageOutcome } from '../pipeline/jobs';
import type { Draft, Evidence } from '../types';
import { InMemoryEditorialStore, applyOutcome } from '../api/store';
import { applyPublication } from '../api/publication';
import { checkPublishable, runDeterministicChecks } from '../rules/rules';
import { draftContentSha256, imageToRights, slugify, toPublishableContent, uniqueSlug, RESUMO_MAX } from '../publishable';

const NOW = new Date('2026-11-24T13:00:00Z');
const URL_PUB = 'https://loyaltynews.example/materia/a1';
let ev: Evidence;
beforeAll(async () => {
  ev = (await new Collector(mockWebRoles(), { minSpacingMs: 0, now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/nomeacoes')).evidence!;
});

const gw = (draft?: () => unknown) => new MockGateway(ev.id, {
  draft: () => mockOk('deepseek', draft ? draft() : rolesDraftOutput(ev.id)),
  factcheck: () => mockOk('anthropic', passAll(['c1', 'c2', 'c3'])),
});

async function run(gateway: MockGateway, over: Partial<StageDeps> = {}, articleId = 'a1', store = new InMemoryEditorialStore()) {
  const deps: StageDeps = { gateway, registry: new SourceRegistry([MOCK_SOURCE]), audit: new InMemoryAuditLog(), flags: { editorialPipeline: true }, now: () => NOW, ...over };
  const q = new InMemoryQueue();
  await q.enqueue({ stage: 'triage', jobId: `${articleId}:triage:0`, data: { articleId, editoria: 'mercado', evidences: [ev], attempt: 0 } });
  await q.drain(makeProcessor(deps, q));
  for (const { spec, outcome } of q.processed) await applyOutcome(store, spec.data, outcome, NOW.toISOString());
  return { store, q, last: q.processed.at(-1)!.outcome as StageOutcome };
}

const baseDraft = async (): Promise<Draft> => (await (async () => (await run(gw())).store.getArticle('a1'))())!.draft!;

test('slug: gerado da manchete (sem acento, hífens), estável nas redações e único via slugExists', async () => {
  assert.equal(slugify('Programa Alfa fecha acordo: nova parceria, em 2026!'), 'programa-alfa-fecha-acordo-nova-parceria-em-2026');
  assert.equal(slugify('Ação & Ímpeto — Não há fim'), 'acao-impeto-nao-ha-fim');
  assert.equal(slugify('!!!'), 'materia');
  assert.ok(slugify('palavra '.repeat(40)).length <= 80);
  const taken = new Set(['mock-alfa-muda-a-diretoria', 'mock-alfa-muda-a-diretoria-2']);
  assert.equal(await uniqueSlug('MOCK: Alfa muda a diretoria', async (s) => taken.has(s)), 'mock-alfa-muda-a-diretoria-3');
  // no pipeline: a 1ª redação gera o slug a partir da manchete e consulta o store
  const { store, last } = await run(gw(), { slugExists: async (s) => taken.has(s) });
  assert.ok(last.kind === 'done');
  assert.equal((await store.getArticle('a1'))?.draft?.slug, 'mock-alfa-muda-a-diretoria-3');
});

test('slug se mantém entre redações (re-redação pedida com nova manchete não troca o slug do job)', async () => {
  const g = gw(() => ({ ...rolesDraftOutput(ev.id), headline: 'MOCK: Outra manchete na segunda redação' }));
  const deps: StageDeps = { gateway: g, registry: new SourceRegistry([MOCK_SOURCE]), audit: new InMemoryAuditLog(), flags: { editorialPipeline: true }, now: () => NOW };
  const o = await draftStage(deps, { articleId: 'a1', editoria: 'mercado', evidences: [ev], attempt: 1, slug: 'mock-alfa-muda-a-diretoria' });
  assert.ok(o.kind === 'next' && o.next.stage === 'factcheck');
  const d = o.kind === 'next' ? o.next.data.draft! : undefined;
  assert.equal(d?.headline, 'MOCK: Outra manchete na segunda redação');
  assert.equal(d?.slug, 'mock-alfa-muda-a-diretoria', 'slug da 1ª redação mantido');
});

test('gate de aprovação: resumo é obrigatório (≤ 300) e sem ele WF02 bloqueia; tipo/classe/patrocínio são do sistema', async () => {
  const noResumo = await run(gw(() => ({ ...rolesDraftOutput(ev.id), resumo: undefined })));
  assert.ok(noResumo.last.kind === 'blocked' && noResumo.last.blocked.stage === 'draft' && !noResumo.last.blocked.blockers.includes('max_attempts'));
  assert.ok(noResumo.last.kind === 'blocked' && noResumo.last.blocked.findings.some((f) => f.code === 'resumo_missing'));
  const longo = await run(gw(() => ({ ...rolesDraftOutput(ev.id), resumo: 'x'.repeat(RESUMO_MAX + 1) })));
  assert.ok(longo.last.kind === 'blocked' && longo.last.blocked.findings.some((f) => f.code === 'resumo_too_long'));
  // o modelo tenta definir patrocínio/classe/tipo: ignorado, o sistema impõe os padrões
  const ok = await run(gw(() => ({ ...rolesDraftOutput(ev.id), patrocinado: true, tipoConteudo: 'patrocinado', classeDeDado: 'restricted', rotuloPublieditorial: 'Publi' })));
  assert.ok(ok.last.kind === 'done');
  const d = (await ok.store.getArticle('a1'))!.draft!;
  assert.deepEqual([d.tipoConteudo, d.classeDeDado, d.patrocinado, d.rotuloPublieditorial], ['noticia', 'public', false, undefined]);
  assert.ok(d.resumo.length > 0 && d.resumo.length <= RESUMO_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug));
});

test('resumo e subtítulo passam pelos mesmos gates do corpo: número inventado, aspas inventadas, entrevista própria e cópia literal', async () => {
  const d = await baseDraft();
  const chk = (over: Partial<Draft>) => runDeterministicChecks({ ...d, ...over }, [ev]).findings.map((f) => f.code);
  assert.deepEqual(chk({}), []);
  assert.ok(chk({ resumo: 'Alta de 87% no trimestre.' }).includes('unsupported_metric'));
  assert.ok(chk({ subtitulo: 'Segundo a empresa, "nenhuma parceria nova foi anunciada este ano" disse a diretora.' }).includes('invented_quote'));
  assert.ok(chk({ resumo: 'Em entrevista exclusiva à Redação, a diretora comentou.' }).includes('fabricated_reporting'));
  assert.ok(chk({ resumo: 'Maria Teste será a nova diretora de Marketing da Empresa Fictícia Alfa, a partir de 1º de dezembro de 2026.' }).includes('copy_literal'));
  // campos publicáveis inválidos
  const p = (over: Partial<Draft>) => checkPublishable({ ...d, ...over }).findings.map((f) => f.code);
  assert.deepEqual(p({ slug: 'Slug Inválido' }), ['slug_invalid']);
  assert.deepEqual(p({ classeDeDado: 'internal' }), ['data_class_not_public']);
  assert.ok(p({ patrocinado: true, rotuloPublieditorial: 'Publi' }).includes('sponsored_not_editorial'));
  assert.ok(p({ tipoConteudo: 'patrocinado' }).includes('sponsored_not_editorial'));
  assert.ok(p({ rotuloPublieditorial: 'Publi' }).includes('label_without_sponsorship'));
});

test('toPublishableContent(rec): mapeamento do ADR-017 §4 e hash que muda com resumo/subtítulo/classe', async () => {
  const { store } = await run(gw());
  const rec = (await store.getArticle('a1'))!;
  const c = toPublishableContent(rec);
  const d = rec.draft!;
  assert.deepEqual(
    { titulo: c.titulo, corpo: c.corpo, resumo: c.resumo, subtitulo: c.subtitulo, tipoConteudo: c.tipoConteudo, editoria: c.editoria, classeDeDado: c.classeDeDado, patrocinado: c.patrocinado, rotulo: c.rotuloPublieditorial, fontes: [...c.fontes], imagem: c.imagem },
    { titulo: d.headline, corpo: d.body, resumo: d.resumo, subtitulo: null, tipoConteudo: 'noticia', editoria: 'pontos', classeDeDado: 'public', patrocinado: false, rotulo: null, fontes: d.evidenceIds, imagem: null },
  );
  assert.equal(toPublishableContent(d).titulo, toPublishableContent(rec).titulo, 'aceita o Draft ou o registro');
  assert.throws(() => toPublishableContent({ draft: undefined }), /sem rascunho/);
  const h = draftContentSha256(rec);
  assert.notEqual(draftContentSha256({ ...d, resumo: `${d.resumo} outro` }), h);
  assert.notEqual(draftContentSha256({ ...d, subtitulo: 'Novo subtítulo' }), h);
  assert.notEqual(draftContentSha256({ ...d, classeDeDado: 'internal' }), h);
  assert.equal(draftContentSha256({ ...d, slug: 'outro-slug' }), h, 'o slug não faz parte de PublishableContent (a imutabilidade dele é regra própria)');
});

test('imagem → ImageRights de @ln/contracts: sem imagem null; com base de direito mapeada; sem base = pendente (não publicável)', async () => {
  const d = await baseDraft();
  assert.equal(imageToRights(d), null);
  const withBasis: Draft = { ...d, image: { mode: 'source_image', sourceId: 'mock-ri', url: 'https://ri.mock.example/i.jpg', credit: 'MOCK Foto', creditLink: 'https://ri.mock.example/', basis: { kind: 'authorization', reference: 'AUT-1', registeredAt: '2026-11-22T00:00:00Z', validatedBy: 'root' }, alt: 'Fachada MOCK' } };
  const r = ImageRights.parse(imageToRights(withBasis));
  assert.deepEqual([r.origem, r.baseDeDireito, r.credito, r.textoAlternativo, r.link], ['fonte_terceiro', 'autorizacao', 'MOCK Foto', 'Fachada MOCK', 'https://ri.mock.example/']);
  const noAlt = ImageRights.parse(imageToRights({ ...withBasis, image: { ...(withBasis.image as Extract<Draft['image'], { mode: 'source_image' }>), alt: undefined } }));
  assert.match(noAlt.textoAlternativo, /Imagem da matéria/);
  const pending = ImageRights.parse(imageToRights({ ...withBasis, image: { ...(withBasis.image as Extract<Draft['image'], { mode: 'source_image' }>), basis: null } }));
  assert.equal(pending.baseDeDireito, 'pendente');
  // a imagem entra no hash
  assert.notEqual(draftContentSha256(withBasis), draftContentSha256(d));
  assert.notEqual(draftContentSha256(withBasis), draftContentSha256({ ...withBasis, image: { ...(withBasis.image as Extract<Draft['image'], { mode: 'source_image' }>), url: 'https://ri.mock.example/outra.jpg' } }));
});

test('a projeção para `articles` valida contra o schema Article de @ln/contracts (status publicado exige resumo)', async () => {
  const { store } = await run(gw());
  const rec = (await store.getArticle('a1'))!;
  const c = toPublishableContent(rec);
  const projected = {
    id: rec.articleId, slug: rec.draft!.slug, titulo: c.titulo, resumo: c.resumo!, tipoConteudo: c.tipoConteudo, editoria: c.editoria, status: 'publicado',
    assinatura: rec.draft!.signature, corpo: c.corpo, classeDeDado: c.classeDeDado, patrocinado: c.patrocinado, versao: 1, publicadoEm: NOW.toISOString(),
    fontes: rec.evidences.filter((e) => c.fontes.includes(e.id)).map((e) => ({ sourceId: e.sourceId, url: e.url, capturadoEm: e.fetchedAt, sha256: e.contentSha256 })),
  };
  const a = Article.safeParse(projected);
  assert.ok(a.success, a.success ? '' : JSON.stringify(a.error.issues));
  // matéria publicada sem resumo seria recusada pelo contrato: o gate do Editorial a barra antes
  assert.equal(Article.safeParse({ ...projected, resumo: undefined }).success, false);
});

test('publicação: slug imutável depois da 1ª publicação e único entre matérias publicadas', async () => {
  const { store } = await run(gw());
  const a = (await store.getArticle('a1'))!;
  const first = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-1', url: URL_PUB, publishedAt: NOW.toISOString(), expectedContentSha256: draftContentSha256(a) });
  assert.ok(first.ok);
  assert.equal((await store.getArticle('a1'))?.publication?.slug, 'mock-alfa-muda-a-diretoria');
  // volta a aprovado (ex.: correção WF08) mudando o slug: recusado depois da 1ª publicação
  const pub = (await store.getArticle('a1'))!;
  await store.putArticle({ ...pub, status: 'aprovado', draft: { ...pub.draft!, slug: 'slug-novo' } });
  const imm = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-2', url: URL_PUB, publishedAt: NOW.toISOString() });
  assert.ok(!imm.ok && imm.code === 'slug_immutable');
  // mesmo slug do a1 em outra matéria: recusado
  await store.putArticle({ ...pub });
  const other = await run(gw(), {}, 'a2', store);
  assert.ok(other.last.kind === 'done');
  const a2 = (await store.getArticle('a2'))!;
  await store.putArticle({ ...a2, draft: { ...a2.draft!, slug: 'mock-alfa-muda-a-diretoria' } });
  const taken = await applyPublication(store, { articleId: 'a2', receiptId: 'rcpt-3', url: 'https://loyaltynews.example/materia/a2', publishedAt: NOW.toISOString() });
  assert.ok(!taken.ok && taken.code === 'slug_taken');
  assert.equal((await store.getArticle('a2'))?.status, 'aprovado');
});
