import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_FLAGS } from '../flags';
import { rasterizeCreative } from '../creative/raster';
import { SimulatedMlabsTransport } from '../mlabs/transport.mock';
import { buildLinkedInPackage } from '../package/linkedin';
import { InMemoryDraftStore, runLinkedInDraftPipeline, toGrowthArticle, type DraftPipelineDeps } from '../pipeline/linkedin-draft';
import { InMemoryUploadLedger } from '../pipeline/raster-upload';
import { mockPublishedRecord, mockSocialPack } from '../../fixtures/published-article.mock';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// O pacote e o pipeline do LinkedIn usam `renderSocialCard` (texto em curvas, rasterizável), não mais `renderPost` (<text>).
const NOW = new Date('2026-11-23T12:00:00.000Z');
const real = (over: Record<string, unknown> = {}) => {
  const base = mockPublishedRecord();
  return mockPublishedRecord({
    publication: { ...base.publication!, isMock: false },
    draft: { ...base.draft!, ...over } as typeof base.draft,
  });
};

describe('pacote LinkedIn com renderSocialCard', () => {
  test('o código do pacote LinkedIn não usa mais renderPost', () => {
    const src = readFileSync(new URL('../package/linkedin.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /renderPost\s*\(/);
    assert.match(src, /renderSocialCard\s*\(/);
  });

  test('criativo e slides do carrossel saem sem <text> e passam pelo rasterizador do UI/UX nas dimensões certas', async () => {
    const p = buildLinkedInPackage(MOCK_ARTICLE);
    assert.doesNotMatch(p.creative.svg, /<text[\s>]/);
    assert.deepEqual([p.creative.width, p.creative.height], [1200, 627]);
    const r = await rasterizeCreative(p.creative);
    assert.deepEqual([r.width, r.height, r.mimeType, r.mock], [1200, 627, 'image/png', true]);
    assert.ok(p.carousel.slides.length >= 3);
    for (const s of p.carousel.slides) assert.doesNotMatch(s.svg, /<text[\s>]/);
  });

  test('o formato do pacote só aceita os dois do card social', () => {
    const sq = buildLinkedInPackage(MOCK_ARTICLE, { format: 'square', carousel: false });
    assert.deepEqual([sq.creative.width, sq.creative.height], [1080, 1080]);
  });
});

describe('conteúdo autoral (analise) e patrocinado no pipeline', () => {
  test('tipoConteudo analise vira o card de análise com selo; matéria comum, card de matéria', () => {
    const a = toGrowthArticle(real({ tipoConteudo: 'analise' }), mockSocialPack());
    assert.ok('article' in a);
    const art = (a as { article: Parameters<typeof buildLinkedInPackage>[0] }).article;
    assert.deepEqual(art.autoral, { formato: 'analise' });
    assert.match(buildLinkedInPackage(art, { carousel: false }).creative.svg, /data-kind="analise"/);
    const b = toGrowthArticle(real(), mockSocialPack());
    assert.equal((b as { article: { autoral?: unknown } }).article.autoral, undefined);
    assert.match(buildLinkedInPackage((b as { article: Parameters<typeof buildLinkedInPackage>[0] }).article, { carousel: false }).creative.svg, /data-kind="materia"/);
  });

  test('autoral + patrocinado é recusado pelo card (nunca leva o selo de autoral): bloqueio regra_de_criativo, nada ao mLabs', async () => {
    const transport = new SimulatedMlabsTransport(() => NOW);
    const deps: DraftPipelineDeps = {
      flags: () => ({ ...DEFAULT_FLAGS, growth_linkedin_live: true }), now: () => NOW.toISOString(), store: new InMemoryDraftStore(),
      live: { transport, profileId: 'ext_P', rasterizer: { rasterize: rasterizeCreative }, putBytes: transport.putBytes },
    };
    const r = await runLinkedInDraftPipeline(deps, real({ tipoConteudo: 'analise', patrocinado: true, rotuloPublieditorial: 'Publieditorial Marca X' }), mockSocialPack());
    assert.equal(r.ok, false);
    assert.deepEqual((r as { blockers: string[] }).blockers, ['regra_de_criativo']);
    assert.equal(transport.calls.length, 0);
  });
});

describe('pipeline ao vivo (mLabs simulado) com o rasterizador REAL (sharp)', () => {
  let transport: SimulatedMlabsTransport;
  let deps: DraftPipelineDeps;
  beforeEach(() => {
    transport = new SimulatedMlabsTransport(() => NOW);
    deps = {
      flags: () => ({ ...DEFAULT_FLAGS, growth_linkedin_live: true }), now: () => NOW.toISOString(), store: new InMemoryDraftStore(),
      live: { transport, profileId: 'ext_PERFIL_DE_TESTE', rasterizer: { rasterize: rasterizeCreative }, putBytes: transport.putBytes, uploadLedger: new InMemoryUploadLedger() },
    };
  });

  test('PNG de verdade: o preparo informa o tamanho EXATO e o sha256 dos bytes enviados, o PUT é aceito e o rascunho leva o imageId; nada agendado', async () => {
    const r = await runLinkedInDraftPipeline(deps, real(), mockSocialPack());
    assert.equal(r.ok, true, JSON.stringify(r));
    const prep = transport.calls.find((c) => c.tool === 'prepare_media_upload')!.args;
    assert.match(String(prep.filename), /^ln-[a-z0-9-]+\.png$/);
    assert.ok((prep.sizeBytes as number) > 1000);
    assert.equal(transport.media.puts, 1);
    const post = transport.calls.find((c) => c.tool === 'create_post')!.args;
    assert.deepEqual(post.imageIds, ['SIM-IMG-SIM-UP-0001']);
    assert.equal(post.status, 'draft');
    assert.equal(transport.count('scheduled') + transport.count('pending_approval'), 0);
  });
});
