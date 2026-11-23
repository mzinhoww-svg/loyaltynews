/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { PgPilotStateStore } from '@ln/workers/openbot-pg';
import { call, makeApp, type Actor } from '../../../../_lib/testkit';
import * as resume from './route';

// DP-41: retomar o piloto depois de uma parada imediata. Só admin, só em staging com o piloto ligado, só com o gate do AgentOps aceitando, auditado.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let chefe: Actor;
const PATH = '/api/studio/openbot/pilot/resume';
const post = (as: Actor | null) => call(resume.POST as never, 'POST', { path: PATH, as, body: {} });
const state = () => new PgPilotStateStore(app.db as any);
const on = () => Object.assign(process.env, { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' });

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe] = [await app.actor('admin'), await app.actor('editor_chefe')];
});
afterEach(() => {
  delete process.env.APP_ENV;
  delete process.env.LN_OPENBOT_PILOT;
  vi.doUnmock('@ln/agents');
});
afterAll(async () => app.close());

describe('POST /api/studio/openbot/pilot/resume', () => {
  it('sem sessão 401; editor-chefe 403 (só admin); fora do staging/sem LN_OPENBOT_PILOT=1 o piloto não existe: 409 PILOT_OFF', async () => {
    expect((await post(null)).status).toBe(401);
    expect((await post(chefe)).status).toBe(403);
    const r = await post(admin);
    expect(r).toMatchObject({ status: 409, body: { error: { code: 'PILOT_OFF' } } });
  });

  it('piloto parado + gate REAL do AgentOps sem linhas pendentes: retoma (200), limpa a parada e audita; sem parada também responde 200', async () => {
    on();
    await state().stop('conta fora da rota', app.clock.now.toISOString());
    expect(await state().get()).not.toBeNull();
    const r = await post(admin);
    expect(r).toMatchObject({ status: 200, body: { resumed: true } });
    expect(await state().get()).toBeNull();
    const logs = await app.db.select().from(schema.auditLog);
    expect(logs.some((l: any) => l.action === 'openbot.piloto_retomado' && l.actorId === admin.id)).toBe(true);
    expect((await post(admin)).status).toBe(200);
  });

  it('o gate ainda recusa as linhas: 409 PILOT_STILL_INVALID com os motivos e a parada continua; sem gate (falha fechado) também não retoma', async () => {
    on();
    await state().stop('linha com tentativa de publicar', app.clock.now.toISOString());
    vi.doMock('@ln/agents', () => ({ canDispatchNext: () => ({ allowed: false, reasons: ['linha t1: published_attempt'] }) }));
    const r = await post(admin);
    expect(r).toMatchObject({ status: 409, body: { error: { code: 'PILOT_STILL_INVALID' } } });
    expect(JSON.stringify(r.body)).toContain('published_attempt');
    expect(await state().get()).not.toBeNull();
    vi.doMock('@ln/agents', () => ({}));
    expect((await post(admin)).status).toBe(409);
    expect(await state().get()).not.toBeNull();
    vi.doUnmock('@ln/agents');
    expect((await post(admin)).status).toBe(200); // o gate real aceita: agora retoma
    expect(await state().get()).toBeNull();
  });
});
