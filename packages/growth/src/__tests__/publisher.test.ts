import { test } from 'vitest';
import assert from 'node:assert/strict';
import { generateLinkedInCopy } from '../copy/engine';
import { DEFAULT_FLAGS } from '../flags';
import { LIVE_ACK, readOnlyTransport } from '../mlabs/live';
import { READ_ONLY_TOOLS, WRITE_TOOLS } from '../mlabs/port';
import { createSocialPublisher, PUBLISHER_SOCIAL, PublishRefused } from '../publisher/publisher';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';
import type { Actor } from '../types';

const clock = () => '2026-11-22T12:00:00.000Z';
function setup(flags = { ...DEFAULT_FLAGS }) {
  const publisher = createSocialPublisher({ mode: 'simulated', flags, now: clock });
  const adapter = publisher.simulated!;
  const copy = generateLinkedInCopy(MOCK_ARTICLE);
  const base = {
    article: MOCK_ARTICLE,
    channel: 'linkedin' as const,
    text: copy.text,
    mentions: copy.mentions,
    idempotencyKey: `${MOCK_ARTICLE.id}:linkedin:v1`,
    imageRef: 'fixture://mock/imagem-aprovada',
  };
  return { adapter, publisher, base };
}

test('flags: tudo desligado por padrão', () => {
  assert.deepEqual(DEFAULT_FLAGS, {
    growth_linkedin_live: false,
    growth_instagram_enabled: false,
    growth_the_loyal_enabled: false,
  });
});

test('agente de redação tentando publicar é recusado e registrado (teste negativo ADR-008)', async () => {
  const { publisher, adapter, base } = setup();
  for (const role of ['redacao', 'design', 'growth_agent', 'unknown'] as const) {
    const actor: Actor = { id: `agente-${role}`, role };
    await assert.rejects(() => publisher.publish(actor, base), (e: unknown) => {
      return e instanceof PublishRefused && e.reason === 'identidade_nao_autorizada';
    });
  }
  assert.equal(adapter.count, 0);
  assert.equal(publisher.audit.filter((a) => a.outcome === 'refused').length, 4);
});

test('publisher_social publica em modo simulado: recibo SIM-, nada enviado ao mLabs', async () => {
  const { publisher, adapter, base } = setup();
  const r = await publisher.publish(PUBLISHER_SOCIAL, base);
  assert.match(r.id, /^SIM-\d{6}$/);
  assert.equal(r.simulated, true);
  assert.equal(r.mode, 'simulated');
  assert.equal(adapter.count, 1);
  assert.equal(publisher.audit.at(-1)?.outcome, 'accepted');
});

test('reenvio com a mesma chave não duplica', async () => {
  const { publisher, adapter, base } = setup();
  const a = await publisher.publish(PUBLISHER_SOCIAL, base);
  const b = await publisher.publish(PUBLISHER_SOCIAL, base);
  assert.equal(a.id, b.id);
  assert.equal(adapter.count, 1);
});

test('sem imagem aprovada, bloqueia', async () => {
  const { publisher, base } = setup();
  await assert.rejects(
    () => publisher.publish(PUBLISHER_SOCIAL, { ...base, imageRef: undefined }),
    (e: unknown) => e instanceof PublishRefused && e.reason === 'sem_imagem_aprovada',
  );
  await assert.rejects(
    () => publisher.publish(PUBLISHER_SOCIAL, { ...base, article: { ...MOCK_ARTICLE, approvedImage: undefined } }),
    (e: unknown) => e instanceof PublishRefused && e.reason === 'sem_imagem_aprovada',
  );
});

test('gates automáticos pendentes bloqueiam', async () => {
  const { publisher, base } = setup();
  await assert.rejects(
    () => publisher.publish(PUBLISHER_SOCIAL, { ...base, article: { ...MOCK_ARTICLE, gatesPassed: false } }),
    (e: unknown) => e instanceof PublishRefused && e.reason === 'gates_automaticos_pendentes',
  );
});

test('texto fora das regras de copy é recusado', async () => {
  const { publisher, base } = setup();
  await assert.rejects(
    () => publisher.publish(PUBLISHER_SOCIAL, { ...base, text: base.text + '\nGanhe 500% a mais!' }),
    (e: unknown) => e instanceof PublishRefused && e.reason.startsWith('copy_invalida:') && e.reason.includes('numero_sem_evidencia'),
  );
});

test('Instagram e The Loyal: com a chave desligada, envio recusado e registrado, mesmo pela identidade de publicação', async () => {
  const { publisher, adapter, base } = setup();
  for (const channel of ['instagram', 'the_loyal'] as const) {
    await assert.rejects(
      () => publisher.publish(PUBLISHER_SOCIAL, { ...base, channel }),
      (e: unknown) => e instanceof PublishRefused && e.reason === `canal_desligado:${channel}`,
    );
  }
  assert.equal(adapter.count, 0);
  const refused = publisher.audit.filter((a) => a.outcome === 'refused').map((a) => a.reason);
  assert.deepEqual(refused, ['canal_desligado:instagram', 'canal_desligado:the_loyal']);
});

test('menção: sem suporte na API do mLabs, cai para texto puro; com suporte e verificada, preserva', async () => {
  const a = setup();
  const r1 = await a.publisher.publish(PUBLISHER_SOCIAL, { ...a.base, mentionsSupported: false });
  const p1 = a.adapter.inspect(r1.id)!;
  assert.ok(!p1.text.includes('@['));
  assert.ok(p1.text.includes('Empresa Exemplo'));
  assert.deepEqual(p1.mentions, []);

  const b = setup();
  const r2 = await b.publisher.publish(PUBLISHER_SOCIAL, { ...b.base, mentionsSupported: true });
  const p2 = b.adapter.inspect(r2.id)!;
  assert.equal(p2.mentions.length, 1);
  assert.equal(p2.mentions[0]?.name, 'Empresa Exemplo');
});

test('editar e excluir (simulado) exigem a identidade de publicação', async () => {
  const { publisher, base } = setup();
  const r = await publisher.publish(PUBLISHER_SOCIAL, base);
  const bad: Actor = { id: 'x', role: 'redacao' };
  await assert.rejects(() => publisher.edit(bad, 'linkedin', r.id, 'novo'), PublishRefused);
  await assert.rejects(() => publisher.remove(bad, 'linkedin', r.id), PublishRefused);
  assert.equal((await publisher.edit(PUBLISHER_SOCIAL, 'linkedin', r.id, 'novo')).status, 'edited');
  assert.equal((await publisher.remove(PUBLISHER_SOCIAL, 'linkedin', r.id)).status, 'deleted');
});

test('modo real: flag desligada depois da criação recusa a publicação e não toca o transporte', async () => {
  let on = true;
  const calls: string[] = [];
  const publisher = createSocialPublisher({
    mode: 'live',
    transport: { call: async (tool) => { calls.push(tool); return {}; } },
    liveAck: LIVE_ACK,
    actor: PUBLISHER_SOCIAL,
    flags: () => ({ ...DEFAULT_FLAGS, growth_linkedin_live: on }),
    now: clock,
  });
  on = false;
  const copy = generateLinkedInCopy(MOCK_ARTICLE);
  await assert.rejects(
    () => publisher.publish(PUBLISHER_SOCIAL, {
      article: MOCK_ARTICLE, channel: 'linkedin', text: copy.text, mentions: copy.mentions,
      idempotencyKey: 'k', imageRef: 'fixture://mock/imagem-aprovada',
    }),
    (e: unknown) => e instanceof PublishRefused && e.reason === 'publicacao_real_desligada',
  );
  assert.deepEqual(calls, []);
});

test('transporte somente-leitura rejeita qualquer ferramenta de escrita', async () => {
  const calls: string[] = [];
  const t = readOnlyTransport({ call: async (tool) => { calls.push(tool); return []; } });
  for (const tool of READ_ONLY_TOOLS) await t.call(tool, {});
  for (const tool of WRITE_TOOLS) {
    await assert.rejects(() => t.call(tool, {}), /fora da lista de leitura/);
  }
  assert.equal(calls.length, READ_ONLY_TOOLS.length);
  assert.equal(READ_ONLY_TOOLS.filter((x) => (WRITE_TOOLS as readonly string[]).includes(x)).length, 0);
});
