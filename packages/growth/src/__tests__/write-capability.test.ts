import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { generateLinkedInCopy } from '../copy/engine';
import { DEFAULT_FLAGS } from '../flags';
import { createLiveMlabsAdapter, LIVE_ACK } from '../mlabs/live';
import type { MlabsAdapter, PostPayload } from '../mlabs/port';
import { SimulatedMlabsAdapter } from '../mlabs/simulated.mock';
import { mintWriteCapability, WriteRefused, type WriteCapability } from '../mlabs/write-gate';
import { PUBLISHER_SOCIAL, SocialPublisher } from '../publisher/publisher';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// QA: o único caminho para criar/agendar/editar/excluir post é o SocialPublisher. Chamar o adaptador direto,
// sem a capability que só o publicador possui, é recusado antes de qualquer efeito.

const payload: PostPayload = { channel: 'linkedin', text: 't', imageRef: 'creative://x/1', mentions: [] };
const refused = (reason: string) => (e: unknown) => e instanceof WriteRefused && e.reason === reason;

function simulated() {
  return new SimulatedMlabsAdapter(() => '2026-11-22T12:00:00.000Z');
}

function live() {
  const calls: string[] = [];
  const adapter = createLiveMlabsAdapter({
    transport: { call: async (tool) => { calls.push(tool); return {}; } },
    liveAck: LIVE_ACK,
    actor: PUBLISHER_SOCIAL,
    flags: () => ({ ...DEFAULT_FLAGS, growth_linkedin_live: true }),
    payloadMapper: {
      create: () => ({ tool: 'create_post', args: {} }),
      toReceipt: (_r, p, key) => ({ id: 'LIVE-1', channel: p.channel, mode: 'live', simulated: false, createdAt: 'x', status: 'scheduled', idempotencyKey: key }),
    },
  });
  return { adapter, calls };
}

const variants: [string, () => { adapter: MlabsAdapter; calls?: string[] }][] = [
  ['simulado', () => ({ adapter: simulated() })],
  ['real', live],
];

for (const [name, make] of variants) {
  describe(`adaptador ${name}: escrita direta recusada`, () => {
    test('sem publicador vinculado: create/update/delete recusam (nenhuma capability vale)', async () => {
      const { adapter, calls } = make();
      const forged = mintWriteCapability();
      await assert.rejects(() => adapter.createPost(forged, payload, 'k'), refused('sem_capability'));
      await assert.rejects(() => adapter.updatePost(forged, 'r', { text: 'x' }), refused('sem_capability'));
      await assert.rejects(() => adapter.deletePost(forged, 'r'), refused('sem_capability'));
      await assert.rejects(() => adapter.createPost(undefined as unknown as WriteCapability, payload, 'k'), refused('sem_capability'));
      assert.equal(calls?.length ?? 0, 0, 'o transporte não foi tocado');
    });

    test('com publicador vinculado: capability forjada, copiada como objeto vazio ou de outro adaptador recusam', async () => {
      const { adapter, calls } = make();
      const publisher = new SocialPublisher({ adapter, flags: { ...DEFAULT_FLAGS, growth_linkedin_live: true } });
      assert.ok(publisher);
      for (const fake of [mintWriteCapability(), {} as WriteCapability, Object.freeze(Object.create(null)) as WriteCapability, 'token' as unknown as WriteCapability, null as unknown as WriteCapability]) {
        await assert.rejects(() => adapter.createPost(fake, payload, 'k'), refused('sem_capability'));
        await assert.rejects(() => adapter.updatePost(fake, 'r', { text: 'x' }), refused('sem_capability'));
        await assert.rejects(() => adapter.deletePost(fake, 'r'), refused('sem_capability'));
      }
      assert.equal(calls?.length ?? 0, 0);
    });

    test('um segundo publicador no mesmo adaptador é recusado (a capability é única)', () => {
      const { adapter } = make();
      new SocialPublisher({ adapter });
      assert.throws(() => new SocialPublisher({ adapter }), refused('capability_ja_vinculada'));
      assert.throws(() => adapter.bindWriteAuthority(mintWriteCapability()), refused('capability_ja_vinculada'));
    });

    test('o publicador não expõe o adaptador nem a capability', () => {
      const { adapter } = make();
      const publisher = new SocialPublisher({ adapter }) as unknown as Record<string, unknown>;
      const names = [...Object.keys(publisher), ...Object.getOwnPropertyNames(Object.getPrototypeOf(publisher))];
      for (const n of names) {
        assert.ok(!['adapter', '_adapter', 'cap', 'capability', '_cap'].includes(n), n);
      }
      assert.equal(JSON.stringify(publisher).includes('adapter'), false);
    });
  });
}

describe('o caminho do SocialPublisher continua funcionando', () => {
  test('simulado: publica, edita e exclui só pelo publicador, e o adaptador registra o efeito', async () => {
    const adapter = simulated();
    const publisher = new SocialPublisher({ adapter, now: () => '2026-11-22T12:00:00.000Z' });
    const copy = generateLinkedInCopy(MOCK_ARTICLE);
    const receipt = await publisher.publish(PUBLISHER_SOCIAL, {
      article: MOCK_ARTICLE, channel: 'linkedin', text: copy.text, mentions: copy.mentions,
      idempotencyKey: 'k1', imageRef: 'fixture://mock/imagem-aprovada',
    });
    assert.match(receipt.id, /^SIM-\d{6}$/);
    assert.equal(adapter.count, 1);
    assert.equal((await publisher.edit(PUBLISHER_SOCIAL, 'linkedin', receipt.id, 'novo')).status, 'edited');
    assert.equal((await publisher.remove(PUBLISHER_SOCIAL, 'linkedin', receipt.id)).status, 'deleted');
    // E, depois de tudo isso, a escrita direta continua recusada.
    await assert.rejects(() => adapter.createPost(mintWriteCapability(), payload, 'k2'), refused('sem_capability'));
    assert.equal(adapter.count, 1);
  });

  test('real via publicador: chega ao transporte com flag, identidade e capability; direto, não', async () => {
    const { adapter, calls } = live();
    const flags = { ...DEFAULT_FLAGS, growth_linkedin_live: true };
    const publisher = new SocialPublisher({ adapter, flags, now: () => 'x' });
    const copy = generateLinkedInCopy(MOCK_ARTICLE);
    const r = await publisher.publish(PUBLISHER_SOCIAL, {
      article: MOCK_ARTICLE, channel: 'linkedin', text: copy.text, mentions: copy.mentions,
      idempotencyKey: 'k1', imageRef: 'fixture://mock/imagem-aprovada',
    });
    assert.equal(r.simulated, false);
    assert.deepEqual(calls, ['create_post']);
    await assert.rejects(() => adapter.createPost(mintWriteCapability(), payload, 'k2'), refused('sem_capability'));
    assert.deepEqual(calls, ['create_post']);
  });
});
