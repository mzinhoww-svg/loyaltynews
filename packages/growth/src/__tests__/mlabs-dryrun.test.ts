import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { LIVE_ACK } from '../mlabs/live';
import { DEFAULT_FLAGS, type GrowthFlags } from '../flags';
import { createSocialPublisher, PUBLISHER_SOCIAL } from '../publisher/publisher';
import { generateLinkedInCopy } from '../copy/engine';
import type { PublishReceipt } from '../mlabs/port';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// DRY-RUN do adaptador mLabs: exercita o modo REAL do publicador (liveAck, identidade publisher_social, flag ligada),
// mas com um transporte que só REGISTRA a chamada — nenhuma rede, nenhum post, nenhuma mídia. É o ensaio do payload
// e da idempotência antes de existir token de servidor.
//
// O mapeamento abaixo é de TESTE (o mapeamento de produção depende de R1-05/R5-02 e ainda não existe). Ele segue a
// regra registrada pelo PM: `create_post` sempre em `draft`, nunca `scheduled`, e `requestId` derivado da chave de
// idempotência para o mLabs deduplicar.

const ON: GrowthFlags = { ...DEFAULT_FLAGS, growth_linkedin_live: true };

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

function dryRun() {
  const calls: Call[] = [];
  const transport = {
    call: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      return { id: `ext_dry_${calls.length}`, status: 'draft' };
    },
  };
  const publisher = createSocialPublisher({
    mode: 'live',
    transport,
    liveAck: LIVE_ACK,
    actor: PUBLISHER_SOCIAL,
    flags: () => ON,
    now: () => '2026-11-26T12:00:00.000Z',
    payloadMapper: {
      create: (payload, key) => ({
        tool: 'create_post',
        args: {
          requestId: key.slice(0, 128),
          profileId: 'ext_perfil_teste',
          channels: ['linkedin'],
          content: payload.link ? `${payload.text}\n\n${payload.link}` : payload.text,
          imageIds: [payload.imageRef],
          // Regra do PM: rascunho ou aprovação por link; nunca agendamento direto.
          status: 'draft',
        },
      }),
      toReceipt: (raw, payload, key): PublishReceipt => ({
        id: String((raw as { id?: string }).id ?? 'sem-id'),
        channel: payload.channel,
        mode: 'live',
        simulated: false,
        createdAt: '2026-11-26T12:00:00.000Z',
        status: 'draft',
        idempotencyKey: key,
      }),
    },
  });
  return { publisher, calls };
}

const request = (key = 'artigo-1__linkedin__v1') => {
  const copy = generateLinkedInCopy(MOCK_ARTICLE);
  return {
    article: MOCK_ARTICLE,
    channel: 'linkedin' as const,
    text: copy.text,
    mentions: copy.mentions,
    idempotencyKey: key,
    imageRef: 'fixture://mock/imagem-aprovada',
  };
};

describe('adaptador mLabs em dry-run (transporte de registro, sem rede)', () => {
  test('publica em rascunho com o payload do LinkedIn: canal, texto, imagem e sem agendamento', async () => {
    const { publisher, calls } = dryRun();
    const receipt = await publisher.publish(PUBLISHER_SOCIAL, request());

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call!.tool, 'create_post');
    assert.deepEqual(Object.keys(call!.args).sort(), ['channels', 'content', 'imageIds', 'profileId', 'requestId', 'status']);
    assert.deepEqual(call!.args.channels, ['linkedin']);
    assert.equal(call!.args.status, 'draft');
    assert.deepEqual(call!.args.imageIds, ['fixture://mock/imagem-aprovada']);
    assert.equal(call!.args.requestId, 'artigo-1__linkedin__v1');
    assert.equal(call!.args.scheduledAt, undefined);
    assert.equal(typeof call!.args.content, 'string');
    assert.ok((call!.args.content as string).length > 100);
    assert.match(call!.args.content as string, /utm_source=linkedin/, 'o texto do pacote leva o link rastreado');
    assert.match(call!.args.content as string, /utm_campaign=/, 'o link leva a campanha da matéria');
    assert.equal(receipt.mode, 'live');
    assert.equal(receipt.simulated, false);
    assert.equal(receipt.status, 'draft');
  });

  test('idempotência: mesma chave não gera segunda chamada e devolve o mesmo recibo', async () => {
    const { publisher, calls } = dryRun();
    const first = await publisher.publish(PUBLISHER_SOCIAL, request('chave-repetida'));
    const second = await publisher.publish(PUBLISHER_SOCIAL, request('chave-repetida'));

    assert.equal(calls.length, 1, 'reenvio com a mesma chave não pode duplicar');
    assert.equal(second.id, first.id);
    assert.equal(second.idempotencyKey, 'chave-repetida');
    assert.equal(calls[0]!.args.requestId, 'chave-repetida');
  });

  test('chave diferente gera uma chamada nova e um requestId novo', async () => {
    const { publisher, calls } = dryRun();
    await publisher.publish(PUBLISHER_SOCIAL, request('chave-a'));
    await publisher.publish(PUBLISHER_SOCIAL, request('chave-b'));

    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.args.requestId), ['chave-a', 'chave-b']);
  });

  test('nenhum dado pessoal no payload enviado ao mLabs', async () => {
    const { publisher, calls } = dryRun();
    await publisher.publish(PUBLISHER_SOCIAL, request());
    const payload = JSON.stringify(calls[0]!.args);
    assert.doesNotMatch(payload, /@[a-z0-9.-]+\.[a-z]{2,}/i, 'e-mail no payload');
    for (const campo of ['email', 'nome', 'telefone', 'cpf', 'token', 'cookie', 'autor']) {
      assert.equal((calls[0]!.args as Record<string, unknown>)[campo], undefined, `${campo} no payload`);
    }
  });
});
