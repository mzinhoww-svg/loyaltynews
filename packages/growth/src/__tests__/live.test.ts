import { test } from 'vitest';
import assert from 'node:assert/strict';
import { LIVE_ACK, LiveAdapterRefused, type LiveOptions } from '../mlabs/live';
import { DEFAULT_FLAGS, type GrowthFlags } from '../flags';
import { createSocialPublisher, PUBLISHER_SOCIAL, PublishRefused } from '../publisher/publisher';
import { generateLinkedInCopy } from '../copy/engine';
import type { PublishReceipt } from '../mlabs/port';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// O adaptador real só existe dentro do publicador: estes testes exercitam o modo real pela única porta pública
// (`createSocialPublisher({ mode: 'live', ... })`).

const ON: GrowthFlags = { ...DEFAULT_FLAGS, growth_linkedin_live: true };

function live(over: Partial<LiveOptions> = {}, flagsFn: () => GrowthFlags = () => ON) {
  const calls: string[] = [];
  const publisher = createSocialPublisher({
    mode: 'live',
    transport: { call: async (tool) => { calls.push(tool); return []; } },
    liveAck: LIVE_ACK,
    actor: PUBLISHER_SOCIAL,
    flags: flagsFn,
    payloadMapper: {
      create: () => ({ tool: 'create_post', args: {} }),
      toReceipt: (_raw, p, key): PublishReceipt => ({
        id: 'LIVE-1', channel: p.channel, mode: 'live', simulated: false, createdAt: 'x', status: 'scheduled', idempotencyKey: key,
      }),
    },
    now: () => 'x',
    ...over,
  });
  return { publisher, calls };
}

const refusal = (reason: string) => (e: unknown) => e instanceof LiveAdapterRefused && e.reason === reason;
const request = () => {
  const copy = generateLinkedInCopy(MOCK_ARTICLE);
  return { article: MOCK_ARTICLE, channel: 'linkedin' as const, text: copy.text, mentions: copy.mentions, idempotencyKey: 'k1', imageRef: 'fixture://mock/imagem-aprovada' };
};

test('criar o modo real recusa sem as três condições: liveAck, identidade publisher_social e flag ligada', () => {
  assert.throws(() => live({ liveAck: 'nope' as never }), refusal('live_ack_ausente'));
  for (const role of ['redacao', 'design', 'growth_agent', 'unknown'] as const) {
    assert.throws(() => live({ actor: { id: 'x', role } }), refusal('identidade_nao_autorizada'));
  }
  assert.throws(() => live({}, () => DEFAULT_FLAGS), refusal('flag_desligada'));
});

test('flag desligada em tempo de execução: leituras do adaptador real recusam e o transporte não é tocado', async () => {
  let on = true;
  const { publisher, calls } = live({}, () => ({ ...DEFAULT_FLAGS, growth_linkedin_live: on }));
  on = false;
  await assert.rejects(() => publisher.reads.listChannels(), refusal('flag_desligada'));
  await assert.rejects(() => publisher.reads.getPostLimits(), refusal('flag_desligada'));
  await assert.rejects(() => publisher.reads.listTemplates(), refusal('flag_desligada'));
  assert.deepEqual(calls, []);
});

test('flag desligada em tempo de execução: publicar, editar e excluir recusam sem tocar o transporte', async () => {
  let on = true;
  const { publisher, calls } = live({}, () => ({ ...DEFAULT_FLAGS, growth_linkedin_live: on }));
  on = false;
  await assert.rejects(() => publisher.publish(PUBLISHER_SOCIAL, request()), (e: unknown) => e instanceof PublishRefused && e.reason === 'publicacao_real_desligada');
  await assert.rejects(() => publisher.edit(PUBLISHER_SOCIAL, 'linkedin', 'r', 'x'), (e: unknown) => e instanceof PublishRefused);
  await assert.rejects(() => publisher.remove(PUBLISHER_SOCIAL, 'linkedin', 'r'), (e: unknown) => e instanceof PublishRefused);
  assert.deepEqual(calls, []);
});

test('com as três condições e mapeamento, a escrita passa pelo transporte; sem mapeamento recusa', async () => {
  const a = live();
  const r = await a.publisher.publish(PUBLISHER_SOCIAL, request());
  assert.equal(r.simulated, false);
  assert.equal(r.mode, 'live');
  assert.deepEqual(a.calls, ['create_post']);

  const b = live({ payloadMapper: undefined });
  await assert.rejects(() => b.publisher.publish(PUBLISHER_SOCIAL, request()), refusal('mapeamento_ausente'));
  assert.deepEqual(b.calls, []);
});

test('edição e exclusão reais não confirmadas: recusam mesmo com tudo ligado', async () => {
  const { publisher, calls } = live();
  await assert.rejects(() => publisher.edit(PUBLISHER_SOCIAL, 'linkedin', 'r', 'x'), refusal('capacidade_nao_confirmada'));
  await assert.rejects(() => publisher.remove(PUBLISHER_SOCIAL, 'linkedin', 'r'), refusal('capacidade_nao_confirmada'));
  assert.deepEqual(calls, []);
});

test('leituras do modo real só usam ferramentas de leitura', async () => {
  const { publisher, calls } = live();
  await publisher.reads.listChannels();
  await publisher.reads.getPostLimits();
  await publisher.reads.listTemplates();
  assert.deepEqual(calls, ['list_channels', 'get_post_limits', 'list_templates']);
});
