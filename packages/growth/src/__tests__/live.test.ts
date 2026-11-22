import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as liveModule from '../mlabs/live';
import * as indexModule from '../index';
import { createLiveMlabsAdapter, LIVE_ACK, LiveAdapterRefused, type LiveOptions } from '../mlabs/live';
import { DEFAULT_FLAGS, type GrowthFlags } from '../flags';
import { PUBLISHER_SOCIAL } from '../publisher/publisher';
import type { PostPayload, PublishReceipt } from '../mlabs/port';
import { mintWriteCapability } from '../mlabs/write-gate';

const payload: PostPayload = { channel: 'linkedin', text: 't', imageRef: 'creative://x/1', mentions: [] };
const ON: GrowthFlags = { ...DEFAULT_FLAGS, growth_linkedin_live: true };

function opts(over: Partial<LiveOptions> = {}) {
  const calls: { tool: string }[] = [];
  const o: LiveOptions = {
    transport: {
      call: async (tool) => {
        calls.push({ tool });
        return [];
      },
    },
    liveAck: LIVE_ACK,
    actor: PUBLISHER_SOCIAL,
    flags: () => ON,
    payloadMapper: {
      create: () => ({ tool: 'create_post', args: {} }),
      toReceipt: (_raw, p, key): PublishReceipt => ({
        id: 'LIVE-1', channel: p.channel, mode: 'live', simulated: false, createdAt: 'x', status: 'scheduled', idempotencyKey: key,
      }),
    },
    ...over,
  };
  return { o, calls };
}

/** Simula o SocialPublisher: vincula uma capability ao adaptador e a devolve. */
function bind(live: { bindWriteAuthority(c: ReturnType<typeof mintWriteCapability>): void }) {
  const cap = mintWriteCapability();
  live.bindWriteAuthority(cap);
  return cap;
}

const refusal = (reason: string) => (e: unknown) => e instanceof LiveAdapterRefused && e.reason === reason;

test('fronteira: a classe do adaptador real não é exportada (só a fábrica)', () => {
  assert.equal('LiveMlabsAdapter' in liveModule, false);
  assert.equal('LiveMlabsAdapter' in indexModule, false);
  assert.equal(typeof liveModule.createLiveMlabsAdapter, 'function');
});

test('fábrica recusa sem as três condições: liveAck, identidade publisher_social e flag ligada', () => {
  assert.throws(() => createLiveMlabsAdapter(opts({ liveAck: 'nope' as never }).o), refusal('live_ack_ausente'));
  for (const role of ['redacao', 'design', 'growth_agent', 'unknown'] as const) {
    assert.throws(() => createLiveMlabsAdapter(opts({ actor: { id: 'x', role } }).o), refusal('identidade_nao_autorizada'));
  }
  assert.throws(() => createLiveMlabsAdapter(opts({ flags: () => DEFAULT_FLAGS }).o), refusal('flag_desligada'));
});

test('chamada DIRETA ao adaptador real: flag desligada depois da criação, nenhuma operação toca o transporte', async () => {
  let flags = ON;
  const { o, calls } = opts({ flags: () => flags });
  const live = createLiveMlabsAdapter(o);
  const cap = bind(live);
  flags = DEFAULT_FLAGS; // desligada em tempo de execução
  await assert.rejects(() => live.createPost(cap, payload, 'k1'), refusal('flag_desligada'));
  await assert.rejects(() => live.updatePost(cap, 'r', { text: 'x' }), refusal('flag_desligada'));
  await assert.rejects(() => live.deletePost(cap, 'r'), refusal('flag_desligada'));
  await assert.rejects(() => live.listChannels(), refusal('flag_desligada'));
  await assert.rejects(() => live.getPostLimits(), refusal('flag_desligada'));
  await assert.rejects(() => live.listTemplates(), refusal('flag_desligada'));
  assert.equal(calls.length, 0);
});

test('chamada DIRETA ao adaptador real: com as três condições e mapeamento, a escrita passa; sem mapeamento recusa', async () => {
  const a = opts();
  const live = createLiveMlabsAdapter(a.o);
  const cap = bind(live);
  const r = await live.createPost(cap, payload, 'k1');
  assert.equal(r.simulated, false);
  assert.deepEqual(a.calls.map((c) => c.tool), ['create_post']);

  const b = opts({ payloadMapper: undefined });
  const liveB = createLiveMlabsAdapter(b.o);
  await assert.rejects(() => liveB.createPost(bind(liveB), payload, 'k'), refusal('mapeamento_ausente'));
  assert.equal(b.calls.length, 0);
});

test('edição e exclusão reais não confirmadas: recusam mesmo com tudo ligado', async () => {
  const { o, calls } = opts();
  const live = createLiveMlabsAdapter(o);
  const cap = bind(live);
  await assert.rejects(() => live.updatePost(cap, 'r', { text: 'x' }), refusal('capacidade_nao_confirmada'));
  await assert.rejects(() => live.deletePost(cap, 'r'), refusal('capacidade_nao_confirmada'));
  assert.equal(calls.length, 0);
});

test('leituras do adaptador real só usam ferramentas de leitura', async () => {
  const { o, calls } = opts();
  const live = createLiveMlabsAdapter(o);
  await live.listChannels();
  await live.getPostLimits();
  await live.listTemplates();
  assert.deepEqual(calls.map((c) => c.tool), ['list_channels', 'get_post_limits', 'list_templates']);
});

test('o transporte cru não é acessível pelo objeto do adaptador', () => {
  const live = createLiveMlabsAdapter(opts().o) as unknown as Record<string, unknown>;
  for (const k of [...Object.keys(live), ...Object.getOwnPropertyNames(Object.getPrototypeOf(live))]) {
    assert.notEqual(k, 'transport');
    assert.notEqual(k, '_transport');
  }
  assert.equal(JSON.stringify(live).includes('transport'), false);
});
