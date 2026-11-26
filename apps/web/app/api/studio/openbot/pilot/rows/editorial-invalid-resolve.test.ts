/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgPilotRowStore } from '@ln/workers/openbot-pg';
import type { PilotRow } from '@ln/openbot';
import { call, makeApp, type Actor } from '../../../../_lib/testkit';
import * as resolve from './[taskId]/[attempt]/resolve/route';

// Decisão do PM (25/11): linha com falha editorial real sai do gate/resume como `editorial_invalid`, sem apagar a linha
// e sem aprovar nada. Linha aprovada nunca aceita essa ação.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
const MOTIVO = 'Falha editorial no gate (unsupported_claim); artigo não publicável, linha descartada do piloto.';
const row = (taskId: string, over: Partial<PilotRow> = {}): PilotRow =>
  ({
    task_id: taskId, kind: 'editorial_draft', article_id: 'art-ed', source_id: 's1', stage: 'draft', account: 'claude', declared_model: 'deepseek-v4.1-flash', prompt_version: 'p1',
    started_at: '2026-11-25T18:00:00.000Z', ended_at: '2026-11-25T18:01:00.000Z', attempt: 1, outcome: 'completed', packet_chars: 100, tokens_measured: false,
    published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  }) as PilotRow;
const resolver = (taskId: string, body: unknown, as: Actor | null = admin) =>
  call(resolve.POST as never, 'POST', {
    path: `/api/studio/openbot/pilot/rows/${taskId}/1/resolve`,
    as,
    params: { taskId, attempt: '1' } as never,
    body,
  });

beforeAll(async () => {
  app = await makeApp();
  admin = await app.actor('admin');
  await new PgPilotRowStore(app.db as any, app.deps.now).upsert(row('ed-blocked', { gate_verdict: 'blocked', gate_reasons: ['unsupported_claim'], unsupported_high: 1 }));
  await new PgPilotRowStore(app.db as any, app.deps.now).upsert(row('ed-approved', { gate_verdict: 'approved', gate_reasons: ['tone_lint'] }));
});
afterAll(async () => app.close());

describe('editorial_invalid no resolve', () => {
  it('sem motivo (ou motivo curto) recusa com 400', async () => {
    expect((await resolver('ed-blocked', { acaoTomada: 'editorial_invalid' })).status).toBe(400);
    expect((await resolver('ed-blocked', { motivo: 'curto', acaoTomada: 'editorial_invalid' })).status).toBe(400);
  });

  it('linha bloqueada com motivo longo resolve com 201 e devolve a falha editorial', async () => {
    const r = await resolver('ed-blocked', { motivo: MOTIVO, acaoTomada: 'editorial_invalid' });
    expect(r).toMatchObject({ status: 201, body: { taskId: 'ed-blocked', jaResolvida: false, tratada: { acao: 'editorial_invalid', motivo: MOTIVO } } });
    expect((r.body as any).falha_editorial.length).toBeGreaterThan(0);
  });

  it('linha aprovada recusa editorial_invalid com 409 APPROVED_NOT_ALLOWED', async () => {
    const r = await resolver('ed-approved', { motivo: MOTIVO, acaoTomada: 'editorial_invalid' });
    expect(r).toMatchObject({ status: 409, body: { error: { code: 'APPROVED_NOT_ALLOWED' } } });
  });
});
