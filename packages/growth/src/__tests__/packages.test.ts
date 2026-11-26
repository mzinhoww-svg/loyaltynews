import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildInstagramPackage, generateInstagramCaption } from '../package/instagram';
import { buildLinkedInPackage } from '../package/linkedin';
import { DEFAULT_FLAGS } from '../flags';
import { createSocialPublisher, PUBLISHER_SOCIAL, PublishRefused } from '../publisher/publisher';
import { CopyRefusal } from '../copy/engine';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

test('pacote LinkedIn: copy + criativo 1200x627 + carrossel (slides) + pedido de publicação', () => {
  const p = buildLinkedInPackage(MOCK_ARTICLE);
  assert.equal(p.channel, 'linkedin');
  assert.equal(p.creative.width, 1200);
  assert.equal(p.creative.height, 627);
  assert.equal(p.idempotencyKey, 'MOCK-2026-0001:linkedin:v1');
  assert.match(p.imageRef, /^creative:\/\/MOCK-2026-0001\/[0-9a-f]{16}$/);
  assert.match(p.creativeSha256, /^[0-9a-f]{64}$/);
  assert.equal(p.carousel.supported, 'unverified');
  assert.equal(p.carousel.pdf, null);
  assert.ok(p.carousel.slides.length >= 3); // capa + fatos + fechamento
  assert.equal(p.carousel.slides[0]?.kind, 'capa');
  assert.equal(p.carousel.slides.at(-1)?.kind, 'fechamento');
  assert.equal(p.publishRequest.mentionsSupported, false); // texto puro por padrão
});

test('pacote LinkedIn: mock e gates pendentes aparecem como bloqueios; brandkit aprovado não bloqueia', () => {
  const p = buildLinkedInPackage({ ...MOCK_ARTICLE, gatesPassed: false, approvedImage: undefined });
  for (const b of ['gates_automaticos_pendentes', 'sem_imagem_aprovada', 'mock_nao_publicavel']) {
    assert.ok(p.blockers.includes(b), b);
  }
  assert.ok(!p.blockers.some((b) => b.startsWith('brandkit_')), 'brandkit aprovado não bloqueia');
});

test('pacote LinkedIn: hash do criativo é estável', () => {
  assert.equal(buildLinkedInPackage(MOCK_ARTICLE).creativeSha256, buildLinkedInPackage(MOCK_ARTICLE).creativeSha256);
});

test('pacote LinkedIn → publisher (simulado): fluxo completo sem enviar nada ao mLabs', async () => {
  const publisher = createSocialPublisher({ mode: 'simulated', now: () => '2026-11-22T12:00:00.000Z' });
  const p = buildLinkedInPackage(MOCK_ARTICLE);
  const r = await publisher.publish(PUBLISHER_SOCIAL, p.publishRequest);
  assert.equal(r.simulated, true);
  assert.equal(publisher.simulated!.count, 1);
});

test('Instagram: construído, flag desligada; envio recusado e registrado', async () => {
  const ig = buildInstagramPackage(MOCK_ARTICLE);
  assert.equal(ig.enabled, false);
  assert.ok(ig.blockers.includes('canal_desligado:instagram'));
  assert.equal(ig.feed.width, 1080); assert.equal(ig.feed.height, 1350);
  assert.equal(ig.story.width, 1080); assert.equal(ig.story.height, 1920);
  assert.ok(!/https?:\/\//.test(ig.caption), 'legenda sem link');
  assert.ok(!ig.caption.includes('@['), 'sem marcação');
  const publisher = createSocialPublisher({ mode: 'simulated' });
  await assert.rejects(() => publisher.publish(PUBLISHER_SOCIAL, ig.publishRequest),
    (e: unknown) => e instanceof PublishRefused && e.reason === 'canal_desligado:instagram');
  assert.equal(publisher.simulated!.count, 0);
  assert.equal(publisher.audit.at(-1)?.reason, 'canal_desligado:instagram');
});

test('Instagram: com a chave ligada (só em teste), o publisher aceita pela identidade de publicação', async () => {
  const flags = { ...DEFAULT_FLAGS, growth_instagram_enabled: true };
  const ig = buildInstagramPackage(MOCK_ARTICLE, flags);
  assert.equal(ig.enabled, true);
  assert.ok(!ig.blockers.includes('canal_desligado:instagram'));
  const publisher = createSocialPublisher({ mode: 'simulated', flags });
  const r = await publisher.publish(PUBLISHER_SOCIAL, ig.publishRequest);
  assert.equal(r.channel, 'instagram');
  assert.equal(r.simulated, true);
});

test('Instagram: legenda segue as mesmas regras (número inventado/autoria)', () => {
  assert.ok(generateInstagramCaption(MOCK_ARTICLE).includes('24 meses'));
  assert.throws(
    () => generateInstagramCaption({ ...MOCK_ARTICLE, facts: [{ text: 'Entrevistamos a diretoria sobre 99 pontos.', source: 's' }] }),
    (e: unknown) => e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'autoria_inventada'),
  );
});
