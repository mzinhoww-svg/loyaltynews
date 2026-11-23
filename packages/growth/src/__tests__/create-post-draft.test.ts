import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { DraftMappingError, linkedinDraftMapper, requestIdFor } from '../mlabs/create-post-draft';
import { generateLinkedInCopy } from '../copy/engine';
import { LIVE_ACK } from '../mlabs/live';
import type { PostPayload } from '../mlabs/port';
import { createSocialPublisher, PUBLISHER_SOCIAL } from '../publisher/publisher';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// Mapeamento SOMENTE rascunho para o create_post do mLabs (esquema da ferramenta lido em 23/11/2026; nada chamado).

const payload = (over: Partial<PostPayload> = {}): PostPayload => ({
  channel: 'linkedin', text: 'Texto do post\nhttps://x.invalid/a', imageRef: 'creative://A/1', mentions: [], ...over,
});
const mapper = (uploads = { 'creative://A/1': { imageIds: ['img-1'] } }) =>
  linkedinDraftMapper({ profileId: 'ext_PERFIL', uploads, now: () => '2026-11-23T12:00:00.000Z' });
const reason = (r: string) => (e: unknown) => e instanceof DraftMappingError && e.reason === r;

describe('linkedinDraftMapper', () => {
  test('gera create_post com status draft, canal linkedin, requestId válido e sem agendamento', () => {
    const { tool, args } = mapper().create(payload(), 'A:linkedin:v1');
    assert.equal(tool, 'create_post');
    assert.deepEqual(args, {
      profileId: 'ext_PERFIL', content: 'Texto do post\nhttps://x.invalid/a', channels: ['linkedin'], status: 'draft',
      requestId: requestIdFor('A:linkedin:v1'), imageIds: ['img-1'],
    });
    for (const forbidden of ['scheduledAt', 'scheduleMessages', 'mentions', 'urlData']) assert.equal(forbidden in args, false, forbidden);
  });

  test('NUNCA emite scheduled nem pending_approval, em nenhuma combinação de entrada', () => {
    const uploads = { 'creative://A/1': { imageIds: ['i'] }, 'creative://B/1': { documentIds: ['d'], documentTitle: 'Carrossel' } };
    for (const imageRef of ['creative://A/1', 'creative://B/1']) {
      for (const scheduleAt of [undefined, '2099-01-01T00:00:00Z']) {
        for (const text of ['', 'x', 'x'.repeat(5000)]) {
          const { args } = mapper(uploads).create(payload({ imageRef, scheduleAt, text }), `k-${imageRef}`);
          assert.equal(args.status, 'draft');
          assert.equal('scheduledAt' in args, false);
        }
      }
    }
  });

  test('requestId: 16–128 caracteres [a-zA-Z0-9_-], determinístico por chave, distinto entre chaves', () => {
    const a = requestIdFor('A:linkedin:v1');
    assert.match(a, /^[a-zA-Z0-9_-]{16,128}$/);
    assert.equal(a, requestIdFor('A:linkedin:v1'));
    assert.notEqual(a, requestIdFor('A:linkedin:v2'));
  });

  test('sem upload da mídia, recusa (sem imagem aprovada não envia)', () => {
    assert.throws(() => mapper({} as never).create(payload(), 'k'), reason('midia_nao_enviada'));
    assert.throws(() => mapper({ 'creative://A/1': { imageIds: [] } }).create(payload(), 'k'), reason('midia_nao_enviada'));
  });

  test('carrossel como documento LinkedIn: documentIds + documentTitles (≤ 100); sem título, recusa', () => {
    const m = mapper({ 'creative://A/1': { documentIds: ['doc-1'], documentTitle: 'T'.repeat(150) } } as never);
    const { args } = m.create(payload(), 'k');
    assert.deepEqual(args.documentIds, ['doc-1']);
    const titles = args.documentTitles as { channelSourceKey: string; text: string }[];
    assert.equal(titles[0]?.channelSourceKey, 'linkedin');
    assert.equal(titles[0]?.text.length, 100);
    assert.throws(() => mapper({ 'creative://A/1': { documentIds: ['doc-1'] } } as never).create(payload(), 'k'), reason('titulo_documento_ausente'));
  });

  test('menção no LinkedIn: o create_post não tem campo para isso, então recusa (texto puro)', () => {
    assert.throws(() => mapper().create(payload({ mentions: [{ name: 'Empresa', ref: 'urn:li:organization:1' }] }), 'k'), reason('mencao_linkedin_nao_suportada'));
  });

  test('perfil ausente recusa na criação; canal pessoal usa a chave linkedin_personal', () => {
    assert.throws(() => linkedinDraftMapper({ profileId: ' ', uploads: {} }), reason('perfil_ausente'));
    const m = linkedinDraftMapper({ profileId: 'ext_P', channelSourceKey: 'linkedin_personal', uploads: { 'creative://A/1': { imageIds: ['i'] } } });
    assert.deepEqual(m.create(payload(), 'k').args.channels, ['linkedin_personal']);
  });

  test('recibo: extrai scheduleId de formas plausíveis, marca draft/não simulado; resposta sem id recusa', () => {
    const m = mapper();
    for (const raw of [{ scheduleId: 'S1' }, { schedule: { id: 'S1' } }, { data: { scheduleId: 'S1' } }]) {
      const r = m.toReceipt(raw, payload(), 'k');
      assert.deepEqual({ id: r.id, st: r.status, sim: r.simulated, mode: r.mode }, { id: 'S1', st: 'draft', sim: false, mode: 'live' });
    }
    for (const raw of [null, 'ok', {}, { scheduleId: 7 }, { scheduleId: '' }]) {
      assert.throws(() => m.toReceipt(raw, payload(), 'k'), reason('resposta_inesperada'));
    }
  });

  test('de ponta a ponta pelo publicador (modo real com transporte falso): só create_post com status draft chega ao transporte', async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const copy = generateLinkedInCopy(MOCK_ARTICLE);
    const imageRef = 'fixture://mock/imagem-aprovada';
    const publisher = createSocialPublisher({
      mode: 'live',
      transport: { call: async (tool, args) => { calls.push({ tool, args }); return { scheduleId: 'SCH-1' }; } },
      liveAck: LIVE_ACK,
      actor: PUBLISHER_SOCIAL,
      flags: () => ({ growth_linkedin_live: true, growth_instagram_enabled: false, growth_the_loyal_enabled: false }),
      payloadMapper: linkedinDraftMapper({ profileId: 'ext_PERFIL', uploads: { [imageRef]: { imageIds: ['img-1'] } } }),
      now: () => '2026-11-23T12:00:00.000Z',
    });
    const receipt = await publisher.publish(PUBLISHER_SOCIAL, {
      article: MOCK_ARTICLE, channel: 'linkedin', text: copy.text, mentions: copy.mentions, idempotencyKey: 'k1', imageRef,
    });
    assert.equal(receipt.id, 'SCH-1');
    assert.equal(receipt.status, 'draft');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.tool, 'create_post');
    assert.equal(calls[0]?.args.status, 'draft');
    assert.equal('scheduledAt' in (calls[0]?.args ?? {}), false);
    assert.ok((calls[0]?.args.content as string).includes('Empresa Exemplo'), 'texto puro, sem marcador @[…]');
    assert.equal((calls[0]?.args.content as string).includes('@['), false);
  });
});
