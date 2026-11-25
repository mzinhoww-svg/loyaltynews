/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgPilotRowStore } from '@ln/workers/openbot-pg';
import type { PilotRow } from '@ln/openbot';
import { call, makeApp, type Actor } from '../../../../_lib/testkit';
import * as configInvalid from './[taskId]/[attempt]/config-invalid/route';

// B2 (QA 10): config_invalid NÃO pode esconder falha editorial. Fato ALTO, veredito bloqueado ou approved com motivo
// bloqueante são recusados com código próprio e o motivo fica visível.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
const MOTIVO = 'Linha com conta/modelo fora da DP-41, criada antes do D1.';
const row = (taskId: string, over: Partial<PilotRow> = {}): PilotRow =>
  ({
    task_id: taskId, kind: 'editorial_draft', article_id: 'art-1', source_id: 's1', stage: 'draft', account: 'claude', declared_model: 'deepseek-v4.1-flash', prompt_version: 'p1',
    started_at: '2026-11-25T18:00:00.000Z', ended_at: '2026-11-25T18:01:00.000Z', attempt: 1, outcome: 'completed', packet_chars: 100, tokens_measured: false,
    published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  }) as PilotRow;
const excluir = (taskId: string, as: Actor | null = admin) =>
  call(configInvalid.POST as never, 'POST', { path: `/api/studio/openbot/pilot/rows/${taskId}/1/config-invalid`, as, params: { taskId, attempt: '1' } as never, body: { motivo: MOTIVO } });

beforeAll(async () => {
  app = await makeApp();
  admin = await app.actor('admin');
  const rows = new PgPilotRowStore(app.db as any, app.deps.now);
  await rows.upsert(row('ed-blocked', { gate_verdict: 'blocked', gate_reasons: ['copy_literal'] }));
  await rows.upsert(row('ed-approved', { gate_verdict: 'approved', gate_reasons: ['unsupported_claim'] }));
  await rows.upsert(row('ed-high', { unsupported_facts: 1, unsupported_high: 1, unsupported_medium: 0, unsupported_low: 0 }));
  await rows.upsert(row('cfg-only'));
});
afterAll(async () => app.close());

describe('config_invalid recusa falha editorial (B2)', () => {
  it('blocked com copy_literal, approved com motivo bloqueante e fato ALTO: 409 EDITORIAL_FAILURE', async () => {
    const b = await excluir('ed-blocked');
    expect(b).toMatchObject({ status: 409, body: { error: { code: 'EDITORIAL_FAILURE' } } });
    expect(JSON.stringify(b.body)).toMatch(/copy_literal/);
    const a = await excluir('ed-approved');
    expect(a).toMatchObject({ status: 409, body: { error: { code: 'EDITORIAL_FAILURE' } } });
    expect(JSON.stringify(a.body)).toMatch(/unsupported_claim/);
    const h = await excluir('ed-high');
    expect(h).toMatchObject({ status: 409, body: { error: { code: 'EDITORIAL_FAILURE' } } });
    expect(JSON.stringify(h.body)).toMatch(/gravidade alta/);
  });

  it('linha só de configuração continua aceita', async () => {
    expect(await excluir('cfg-only')).toMatchObject({ status: 201, body: { tratada: { acao: 'config_invalid' } } });
  });
});
