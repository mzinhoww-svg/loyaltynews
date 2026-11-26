import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_FLAGS, type GrowthFlags } from '../flags';
import { SimulatedMlabsTransport } from '../mlabs/transport.mock';
import { InMemoryUploadLedger } from '../pipeline/raster-upload';
import { SimulatedRasterizer } from '../pipeline/raster-upload.mock';
import {
  approvedFacts, InMemoryDraftStore, runLinkedInDraftPipeline, toGrowthArticle, type DraftPipelineDeps, type DraftPipelineResult,
  type DraftPipelineSummary, type PipelineArticleRecord,
} from '../pipeline/linkedin-draft';
import { mockPublishedRecord, mockSocialPack } from '../../fixtures/published-article.mock';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const ON: GrowthFlags = { ...DEFAULT_FLAGS, growth_linkedin_live: true };

let flags: GrowthFlags;
let transport: SimulatedMlabsTransport;
let rasterizer: SimulatedRasterizer;
const posts = () => transport.calls.filter((c) => c.tool === 'create_post');
let store: InMemoryDraftStore;
let deps: DraftPipelineDeps;

beforeEach(() => {
  flags = { ...DEFAULT_FLAGS };
  transport = new SimulatedMlabsTransport(() => NOW);
  rasterizer = new SimulatedRasterizer();
  store = new InMemoryDraftStore();
  deps = { flags: () => flags, now: () => NOW.toISOString(), store, live: { transport, profileId: 'ext_PERFIL_DE_TESTE', rasterizer, putBytes: transport.putBytes, uploadLedger: new InMemoryUploadLedger() } };
});

/** Matéria de produção (não-mock): o mock nunca vai ao mLabs real/simulado de transporte. */
const real = (over: Partial<PipelineArticleRecord['publication'] & object> = {}) =>
  mockPublishedRecord({ publication: { ...mockPublishedRecord().publication!, isMock: false, ...over } });
const ok = (r: DraftPipelineResult): DraftPipelineSummary => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; summary: DraftPipelineSummary }).summary;
};
const blockers = (r: DraftPipelineResult) => (r.ok ? [] : r.blockers);

describe('contrato com a Fábrica editorial', () => {
  test('ArticleRecord e SocialPack REAIS (@ln/editorial) são aceitos pelo tipo estrutural do pipeline (conferido na compilação)', () => {
    const rec: PipelineArticleRecord = mockPublishedRecord();
    assert.equal(rec.articleId, 'MOCK-2026-0001');
    assert.equal(mockSocialPack().articleId, rec.articleId);
  });

  test('fatos aprovados: só afirmações fact/number/date com checagem pass e evidência; reprovada, citação e sem evidência ficam de fora', () => {
    const facts = approvedFacts(mockPublishedRecord());
    assert.deepEqual(facts.map((f) => f.source), ['evidence:ev1', 'evidence:ev1']);
    const text = facts.map((f) => f.text).join(' ');
    assert.ok(text.includes('24 meses') && text.includes('1 de janeiro'));
    for (const out of ['99 mil', 'Citação literal', 'sem evidência']) assert.equal(text.includes(out), false, out);
  });
});

describe('ensaio (flag desligada, padrão): nada sai do processo', () => {
  test('gera o rascunho simulado, status draft, sem tocar o transporte nem a mídia', async () => {
    const s = ok(await runLinkedInDraftPipeline(deps, mockPublishedRecord(), mockSocialPack()));
    assert.equal(s.mode, 'simulated');
    assert.match(s.receipt.id, /^SIM-\d{6}$/);
    assert.equal(s.receipt.status, 'draft');
    assert.equal(s.receipt.simulated, true);
    assert.equal(transport.calls.length, 0);
    assert.deepEqual(transport.media, { prepares: 0, puts: 0, polls: 0 });
  });

  test('a matéria MOCK é aceita no ensaio (nada sai) e não avisa brandkit de proposta', async () => {
    const s = ok(await runLinkedInDraftPipeline(deps, mockPublishedRecord(), mockSocialPack()));
    assert.ok(!s.warnings.includes('brandkit_proposal_not_approved'));
  });

  test('flag ligada mas sem configuração live: continua ensaio', async () => {
    flags = ON;
    const s = ok(await runLinkedInDraftPipeline({ ...deps, live: undefined }, real(), mockSocialPack()));
    assert.equal(s.mode, 'simulated');
    assert.equal(transport.calls.length, 0);
  });
});

describe('rascunho no mLabs SIMULADO (flag ligada só no teste)', () => {
  beforeEach(() => {
    flags = ON;
  });

  test('exatamente um create_post, com status draft, canal linkedin, sem agendamento; nada agendado nem em aprovação', async () => {
    const s = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    assert.equal(s.mode, 'live');
    assert.equal(s.receipt.status, 'draft');
    assert.equal(s.receipt.simulated, false);
    assert.equal(posts().length, 1);
    const { tool, args } = posts()[0]!;
    assert.equal(tool, 'create_post');
    assert.equal(args.status, 'draft');
    assert.deepEqual(args.channels, ['linkedin']);
    assert.equal(args.profileId, 'ext_PERFIL_DE_TESTE');
    assert.equal('scheduledAt' in args, false);
    assert.deepEqual(transport.all.map((p) => p.status), ['draft']);
    assert.equal(transport.count('scheduled'), 0);
    assert.equal(transport.count('pending_approval'), 0);
    assert.match(String(args.requestId), /^ln-[0-9a-f]{40}$/);
    assert.equal(s.receipt.id, transport.all[0]!.scheduleId);
  });

  test('o texto do rascunho vem só dos fatos aprovados: sem o fato reprovado, sem citação e sem o texto livre do modelo', async () => {
    await runLinkedInDraftPipeline(deps, real(), mockSocialPack());
    const content = String(posts()[0]!.args.content);
    assert.ok(content.includes('24 meses'));
    assert.ok(content.includes('Redação Loyalty News'));
    assert.ok(content.includes('utm_source=linkedin'));
    for (const out of ['99', 'Citação literal', 'Texto livre do modelo', 'sem evidência']) assert.equal(content.includes(out), false, out);
  });

  test('a mídia é enviada antes do rascunho e o id vai no create_post', async () => {
    const s = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    assert.deepEqual([transport.media.prepares, transport.media.puts], [1, 1]);
    const order = transport.calls.map((c) => c.tool);
    assert.ok(order.indexOf('prepare_media_upload') < order.indexOf('create_post'), 'mídia antes do rascunho');
    assert.equal(order.at(-1), 'create_post');
    assert.deepEqual(posts()[0]!.args.imageIds, ['SIM-IMG-SIM-UP-0001']);
    assert.equal(s.mode, 'live');
  });

  test('reenvio não duplica: segunda execução devolve o rascunho existente e não chama o mLabs de novo', async () => {
    const a = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    const b = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    assert.equal(a.existing, false);
    assert.equal(b.existing, true);
    assert.equal(b.receipt.id, a.receipt.id);
    assert.equal(posts().length, 1);
    assert.equal(transport.all.length, 1);
  });

  test('mesmo sem o registro local, o requestId impede segundo rascunho no mLabs (idempotência documentada)', async () => {
    const a = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    const b = ok(await runLinkedInDraftPipeline({ ...deps, store: new InMemoryDraftStore() }, real(), mockSocialPack()));
    assert.equal(b.receipt.id, a.receipt.id);
    assert.equal(posts().length, 2);
    assert.equal(transport.media.prepares, 1, 'a imagem não sobe de novo: o registro dos envios é pelo hash do SVG');
    assert.equal(transport.all.length, 1);
  });

  test('matéria corrigida (hash novo do conteúdo publicado) gera um novo rascunho', async () => {
    const a = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    const b = ok(await runLinkedInDraftPipeline(deps, real({ contentSha256: 'c'.repeat(64) }), mockSocialPack()));
    assert.notEqual(b.receipt.id, a.receipt.id);
    assert.equal(transport.all.length, 2);
  });

  test('matéria MOCK nunca vai ao transporte, com a flag ligada', async () => {
    const r = await runLinkedInDraftPipeline(deps, mockPublishedRecord(), mockSocialPack());
    assert.deepEqual(blockers(r), ['mock_nao_vai_ao_mlabs']);
    assert.equal(transport.calls.length, 0);
  });

  test('mídia indisponível (preparo, PUT, processamento): bloqueia sem criar rascunho, sem vazar a URL assinada, e a nova tentativa funciona', async () => {
    for (const fail of [{ prepare: true }, { putStatus: 403 }, { processing: 'failed' as const }]) {
      transport.mediaFail = fail;
      const r = await runLinkedInDraftPipeline(deps, real(), mockSocialPack());
      assert.deepEqual(blockers(r), ['midia_nao_enviada'], JSON.stringify(fail));
      assert.doesNotMatch(JSON.stringify(r), /sig=|exemplo\.invalid|upload\.simulado/);
      assert.equal(posts().length, 0, 'sem mídia não há rascunho');
    }
    transport.mediaFail = {};
    ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    assert.equal(posts().length, 1);
  });

  test('criativo rasterizado inválido (hash do SVG, mock): mídia não sobe e nada é preparado', async () => {
    rasterizer.tamper = { svgSha256: '0'.repeat(64) };
    assert.deepEqual(blockers(await runLinkedInDraftPipeline(deps, real(), mockSocialPack())), ['midia_nao_enviada']);
    assert.equal(transport.media.prepares, 0);
    assert.equal(posts().length, 0);
  });

  test('mLabs indisponível: o erro sobe, nada é registrado e a nova tentativa funciona', async () => {
    transport.failNext = 1;
    await assert.rejects(() => runLinkedInDraftPipeline(deps, real(), mockSocialPack()), /indisponível/);
    assert.equal(await store.get(`${real().articleId}:linkedin:draft:${'b'.repeat(16)}`), null);
    const s = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    assert.equal(s.existing, false);
    assert.equal(transport.all.length, 1);
  });

  test('flag desligada depois de configurada: volta a ensaio, sem tocar o transporte', async () => {
    flags = { ...DEFAULT_FLAGS };
    const s = ok(await runLinkedInDraftPipeline(deps, real(), mockSocialPack()));
    assert.equal(s.mode, 'simulated');
    assert.equal(transport.calls.length, 0);
  });

  test('patrocinada: o rótulo de publieditorial vai no rascunho; sem rótulo, bloqueia', async () => {
    const base = mockPublishedRecord();
    const sponsored = (label?: string) => ({ ...real(), draft: { ...real().draft!, patrocinado: true, rotuloPublieditorial: label } });
    const ok1 = await runLinkedInDraftPipeline(deps, sponsored('Publieditorial Marca X'), mockSocialPack());
    assert.equal(ok1.ok, true);
    assert.ok(String(posts()[0]!.args.content).includes('Conteúdo patrocinado: Publieditorial Marca X'));
    const bad = await runLinkedInDraftPipeline({ ...deps, store: new InMemoryDraftStore() }, { ...sponsored(undefined), articleId: base.articleId }, mockSocialPack());
    assert.deepEqual(blockers(bad), ['regra_de_copy']);
  });
});

describe('bloqueios (sem efeito em lugar nenhum)', () => {
  const cases: [string, () => [PipelineArticleRecord, ReturnType<typeof mockSocialPack> | undefined], string[]][] = [
    ['matéria só aprovada, não publicada', () => [mockPublishedRecord({ status: 'aprovado' }), mockSocialPack()], ['materia_nao_publicada']],
    ['sem recibo de publicação', () => [mockPublishedRecord({ publication: undefined }), mockSocialPack()], ['sem_recibo_de_publicacao']],
    ['sem rascunho', () => [mockPublishedRecord({ draft: undefined }), mockSocialPack()], ['sem_rascunho']],
    ['sem pacote social', () => [mockPublishedRecord(), undefined], ['pacote_social_ausente']],
    ['pacote da Fábrica bloqueado (sem imagem)', () => [mockPublishedRecord(), mockSocialPack({ blockers: ['no_image'] })], ['pacote_social_bloqueado']],
    ['pacote de outra matéria', () => [mockPublishedRecord(), mockSocialPack({ articleId: 'OUTRA' })], ['pacote_de_outra_materia']],
    ['URL do pacote diverge da publicada', () => [mockPublishedRecord(), mockSocialPack({ linkedin: { text: 't', url: 'https://example.invalid/outra?utm_source=linkedin', utm: { source: 'linkedin', medium: 'social', campaign: 'c' } } })], ['url_divergente']],
    ['menção no pacote', () => [mockPublishedRecord(), mockSocialPack({ mentions: ['@alguem'] })], ['mencao_nao_verificada']],
  ];
  for (const [name, mk, expected] of cases) {
    test(name, async () => {
      flags = ON;
      const [rec, pack] = mk();
      const r = await runLinkedInDraftPipeline(deps, rec, pack);
      assert.deepEqual(blockers(r), expected);
      assert.equal(transport.calls.length, 0);
      assert.deepEqual(transport.media, { prepares: 0, puts: 0, polls: 0 });
      assert.equal(await store.get(`${rec.articleId}:linkedin:draft:${'b'.repeat(16)}`), null);
    });
  }

  test('sem imagem aprovada (nenhuma, ou de terceiro sem base de direito): bloqueia', async () => {
    flags = ON;
    const base = mockPublishedRecord();
    const none = mockPublishedRecord({ draft: { ...base.draft!, image: { mode: 'none', reason: 'sem imagem' } } });
    assert.deepEqual(blockers(await runLinkedInDraftPipeline(deps, none, mockSocialPack())), ['sem_imagem_aprovada']);
    const noBasis = mockPublishedRecord({ draft: { ...base.draft!, image: { mode: 'source_image', sourceId: 's', url: 'https://x.invalid/i.png', credit: 'Crédito', creditLink: 'https://x.invalid/', basis: null } } });
    assert.deepEqual(blockers(await runLinkedInDraftPipeline(deps, noBasis, mockSocialPack())), ['sem_imagem_aprovada']);
  });

  test('sem nenhum fato checado: bloqueia (sem fato, sem post)', async () => {
    const base = mockPublishedRecord();
    const rec = mockPublishedRecord({ factcheck: { ...base.factcheck!, verdicts: base.factcheck!.verdicts.map((v) => ({ ...v, verdict: 'fail' as const })) } });
    assert.deepEqual(blockers(await runLinkedInDraftPipeline(deps, rec, mockSocialPack())), ['sem_fatos_checados']);
  });

  test('título com número sem fato checado correspondente: bloqueia por regra de copy', async () => {
    const base = mockPublishedRecord();
    const rec = mockPublishedRecord({ draft: { ...base.draft!, headline: 'Programa muda regra em 2027' } });
    assert.deepEqual(blockers(await runLinkedInDraftPipeline(deps, rec, mockSocialPack())), ['regra_de_copy']);
  });

  test('toGrowthArticle: editoria por nome, gates aprovados, imagem conceitual com o crédito institucional', () => {
    const r = toGrowthArticle(mockPublishedRecord(), mockSocialPack());
    assert.ok('article' in r);
    if ('article' in r) {
      assert.equal(r.article.editoria, 'Programas de Fidelidade');
      assert.equal(r.article.gatesPassed, true);
      assert.equal(r.article.mock, true);
      assert.ok(r.article.approvedImage?.credit.length);
    }
  });
});
