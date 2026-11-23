// DP-41 (piloto pelo OpenBot, só staging): carregador do gateway e do sink do piloto no worker.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadPilotWiring } from './editorial-factory';

test('loadPilotWiring: só com LN_OPENBOT_PILOT=1 E APP_ENV=staging; ligado sem o módulo de fiação recusa começar; com ele devolve gateway e sink', async () => {
  let imports = 0;
  const gw = { invoke: async () => ({ ok: false as const, refusal: 'model_disabled' as const }) };
  const sink = { patch: async () => {} };
  const importer = async (spec: string) => { imports++; return { createPilotWiring: async (env: Record<string, string | undefined>) => ({ gateway: gw, sink, spec, env }) }; };
  assert.equal(await loadPilotWiring({}, importer), undefined);
  assert.equal(await loadPilotWiring({ LN_OPENBOT_PILOT: '0', APP_ENV: 'staging' }, importer), undefined);
  assert.equal(imports, 0, 'desligado não importa nada');
  await assert.rejects(() => loadPilotWiring({ LN_OPENBOT_PILOT: '1', APP_ENV: 'production' }, importer), /só vale com APP_ENV=staging/);
  await assert.rejects(() => loadPilotWiring({ LN_OPENBOT_PILOT: '1' }, importer), /só vale com APP_ENV=staging/);
  await assert.rejects(() => loadPilotWiring({ LN_OPENBOT_PILOT: '1', APP_ENV: 'staging' }, async () => { throw new Error('x'); }), /createPilotWiring\) não está disponível/);
  await assert.rejects(() => loadPilotWiring({ LN_OPENBOT_PILOT: '1', APP_ENV: 'staging' }, async () => ({ createPilotWiring: async () => ({}) })), /gateway com invoke/);
  const w = await loadPilotWiring({ LN_OPENBOT_PILOT: '1', APP_ENV: 'staging' }, importer);
  assert.equal(w!.gateway, gw); assert.equal(w!.sink, sink); assert.equal(imports, 1);
});
