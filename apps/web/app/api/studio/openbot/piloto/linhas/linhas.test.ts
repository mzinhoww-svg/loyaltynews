/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { PILOT_CSV_COLUMNS, type PilotRow } from '@ln/openbot';
import { PgPilotRowStore } from '@ln/workers/openbot-pg';
import { call, makeApp, type Actor } from '../../../../_lib/testkit';
import * as linhas from './route';

// Studio 2 lê as linhas do piloto por esta rota (exportação da planilha, PM-2026-11-23-F): só leitura, admin e editor-chefe, auditada, mesmo com o piloto desligado.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let chefe: Actor;
let editor: Actor;
let leitor: Actor;
const PATH = '/api/studio/openbot/piloto/linhas';
const get = (as: Actor | null) => call(linhas.GET as never, 'GET', { path: PATH, as });
const row = (taskId: string, attempt: number, startedAt: string, over: Partial<PilotRow> = {}): PilotRow =>
  ({
    task_id: taskId, kind: 'editorial_draft', article_id: 'art-1', source_id: 's1', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet-5-5', prompt_version: 'p1',
    started_at: startedAt, ended_at: startedAt, attempt, outcome: 'completed', published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  }) as unknown as PilotRow;

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor, leitor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'), await app.actor('leitor')];
});
afterAll(async () => app.close());

describe('GET /api/studio/openbot/piloto/linhas', () => {
  it('sem sessão 401; editor e leitor 403; piloto desligado e sem linhas: 200 com lista vazia', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(editor)).status).toBe(403);
    expect((await get(leitor)).status).toBe(403);
    delete process.env.APP_ENV;
    delete process.env.LN_OPENBOT_PILOT;
    const r = await get(admin);
    expect(r).toMatchObject({ status: 200, body: { items: [] } });
  });

  it('admin e editor-chefe leem as linhas na ordem started_at, task_id, attempt, com os campos da planilha; funciona sem APP_ENV=staging', async () => {
    const rs = new PgPilotRowStore(app.db as any, app.deps.now);
    await rs.upsert(row('task-b', 1, '2026-11-23T12:00:00.000Z', { stage: 'factcheck', account: 'codex', declared_model: 'gpt-5.1-codex' }));
    await rs.upsert(row('task-a', 2, '2026-11-23T12:00:00.000Z'));
    await rs.upsert(row('task-a', 1, '2026-11-23T11:00:00.000Z', { outcome: 'failed' }));
    for (const quem of [admin, chefe]) {
      const r = await get(quem);
      expect(r.status).toBe(200);
      expect(r.body.items.map((x: any) => `${x.task_id}#${x.attempt}`)).toEqual(['task-a#1', 'task-a#2', 'task-b#1']);
      // só colunas da planilha do AgentOps (nada interno): cada chave da linha é uma coluna conhecida
      for (const x of r.body.items) expect(Object.keys(x).filter((k) => !(PILOT_CSV_COLUMNS as readonly string[]).includes(k))).toEqual([]);
    }
  });

  it('é somente leitura (POST/PUT/DELETE não existem) e a leitura é auditada com quem leu', async () => {
    const logs = await app.db.select().from(schema.auditLog);
    expect(logs.some((l: any) => l.action === 'openbot.piloto_linhas_lidas' && l.actorId === admin.id)).toBe(true);
    expect((linhas as any).POST).toBeUndefined();
    expect((linhas as any).PUT).toBeUndefined();
    expect((linhas as any).DELETE).toBeUndefined();
  });
});
