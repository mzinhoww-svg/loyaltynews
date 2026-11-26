/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { PgPilotResolutionStore, PgPilotRowStore, PgPilotStateStore } from '@ln/workers/openbot-pg';
import type { PilotRow } from '@ln/openbot';
import { call, makeApp, type Actor } from '../../../../_lib/testkit';
import * as configInvalid from './[taskId]/[attempt]/config-invalid/route';
import * as resolve from './[taskId]/[attempt]/resolve/route';
import * as resume from '../resume/route';
import * as linhas from '../../piloto/linhas/route';

// Decisão do PM (25/11): linha inválida SÓ por configuração (conta/modelo fora da DP-41, criada antes do D1) é EXCLUÍDA POR
// CONFIGURAÇÃO: preservada na planilha, marcada com ação `config_invalid` e liberada do portão de despacho. Não é violação.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let chefe: Actor;
let editor: Actor;
const MOTIVO = 'Linha criada antes do D1, com conta claude e modelo deepseek; descartada por configuracao.';
const row = (taskId: string, attempt: number, over: Partial<PilotRow> = {}): PilotRow =>
  ({
    task_id: taskId, kind: 'editorial_draft', article_id: 'art-1', source_id: 's1', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet-5-5', prompt_version: 'p1',
    started_at: '2026-11-25T18:00:00.000Z', ended_at: '2026-11-25T18:01:00.000Z', attempt, outcome: 'completed', packet_chars: 100, tokens_measured: false,
    published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  }) as PilotRow;
const excluir = (taskId: string, attempt: string, as: Actor | null, body: unknown = { motivo: MOTIVO }) =>
  call(configInvalid.POST as never, 'POST', { path: `/api/studio/openbot/pilot/rows/${taskId}/${attempt}/config-invalid`, as, params: { taskId, attempt } as never, body });
const resolver = (taskId: string, attempt: string, as: Actor | null, body: unknown) =>
  call(resolve.POST as never, 'POST', { path: `/api/studio/openbot/pilot/rows/${taskId}/${attempt}/resolve`, as, params: { taskId, attempt } as never, body });
const retomar = (as: Actor | null) => call(resume.POST as never, 'POST', { path: '/api/studio/openbot/pilot/resume', as, body: {} });
const listar = (as: Actor | null) => call(linhas.GET as never, 'GET', { path: '/api/studio/openbot/piloto/linhas', as });
const rows = () => new PgPilotRowStore(app.db as any, app.deps.now);
const state = () => new PgPilotStateStore(app.db as any);
const on = () => Object.assign(process.env, { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' });

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor')];
  await rows().upsert(row('cfg-1', 1, { declared_model: 'deepseek-v4.1-flash' }));
  await rows().upsert(row('cfg-resume', 1, { declared_model: 'opencode/deepseek-v4.1-flash-free' }));
  await rows().upsert(row('ok-1', 1));
  await rows().upsert(row('viol-1', 1, { declared_model: 'deepseek-v4.1-flash', published_attempt: true }));
});
afterEach(() => {
  delete process.env.APP_ENV;
  delete process.env.LN_OPENBOT_PILOT;
});
afterAll(async () => app.close());

describe('POST /api/studio/openbot/pilot/rows/:taskId/:attempt/config-invalid', () => {
  it('só admin: sem sessão 401, editor-chefe 403, editor 403; ids inválidos 400; linha inexistente 404; motivo curto 400', async () => {
    expect((await excluir('cfg-1', '1', null)).status).toBe(401);
    expect((await excluir('cfg-1', '1', chefe)).status).toBe(403);
    expect((await excluir('cfg-1', '1', editor)).status).toBe(403);
    expect((await excluir('cfg-1', 'x', admin)).status).toBe(400);
    expect((await excluir('id com espaço', '1', admin)).status).toBe(400);
    expect((await excluir('nao-existe', '1', admin)).status).toBe(404);
    expect((await excluir('cfg-1', '1', admin, { motivo: 'curto' })).status).toBe(400);
  });

  it('recusa linha válida (NOT_CONFIG_INVALID) e linha com parada imediata (NOT_CONFIG_ONLY), sem gravar resolução', async () => {
    expect((await excluir('ok-1', '1', admin)).body.error.code).toBe('NOT_CONFIG_INVALID');
    expect((await excluir('viol-1', '1', admin)).body.error.code).toBe('NOT_CONFIG_ONLY');
    expect(await new PgPilotResolutionStore(app.db as any).all()).toEqual([]);
  });

  it('marca a linha como excluída por configuração: 201, linha intocada, resolução config_invalid, auditada; repetir = 200', async () => {
    const antes = (await rows().all()).find((r) => r.task_id === 'cfg-1')!;
    const r = await excluir('cfg-1', '1', admin);
    expect(r).toMatchObject({ status: 201, body: { taskId: 'cfg-1', attempt: 1, jaResolvida: false, tratada: { por: admin.id, motivo: MOTIVO, acao: 'config_invalid' } } });
    expect(r.body.config.join(' ')).toMatch(/conta claude serve modelo de autor anthropic/);
    const de = await excluir('cfg-1', '1', admin, { motivo: 'Outro motivo suficientemente longo.' });
    expect(de).toMatchObject({ status: 200, body: { jaResolvida: true, tratada: { motivo: MOTIVO } } });
    expect((await rows().all()).find((x) => x.task_id === 'cfg-1')).toEqual(antes);
    expect(await new PgPilotResolutionStore(app.db as any).keys()).toContain('cfg-1#1');
    expect((await app.db.select().from(schema.auditLog)).some((l: any) => l.action === 'openbot.piloto_linha_config_invalida' && l.actorId === admin.id)).toBe(true);
    const log = (await app.db.select().from(schema.auditLog)).find((l: any) => l.action === 'openbot.piloto_linha_config_invalida' && l.actorId === admin.id);
    if (!log) throw new Error('auditoria da linha não encontrada');
    expect(log).toMatchObject({ resourceId: 'cfg-1#1' });
    expect(JSON.stringify(log.detalhe)).toContain(MOTIVO);
  });

  it('a planilha mostra TODAS as linhas; a excluída leva tratada.acao = config_invalid', async () => {
    const r = await listar(chefe);
    expect(r.status).toBe(200);
    const por = (id: string) => r.body.items.find((x: any) => x.task_id === id);
    expect(r.body.items).toHaveLength(4);
    expect(por('cfg-1')).toMatchObject({ declared_model: 'deepseek-v4.1-flash', tratada: { acao: 'config_invalid', motivo: MOTIVO } });
    expect(por('ok-1')).not.toHaveProperty('tratada');
  });

  it('depois de excluir a linha por configuração a retomada deixa de citá-la (409 -> 200 quando as demais estão tratadas)', async () => {
    on();
    await state().stop('conta/modelo fora da DP-41', app.clock.now.toISOString());
    const antes = await retomar(admin);
    expect(antes.status).toBe(409);
    expect(JSON.stringify(antes.body)).toContain('cfg-resume');
    expect(JSON.stringify(antes.body)).not.toContain('cfg-1');
    expect((await excluir('cfg-resume', '1', admin)).status).toBe(201);
    expect((await resolver('viol-1', '1', admin, { motivo: 'Tentativa de publicar bloqueada na origem; sem efeito.', acaoTomada: 'bloqueio_confirmado' })).status).toBe(201);
    expect(await retomar(admin)).toMatchObject({ status: 200, body: { resumed: true } });
    expect(await state().get()).toBeNull();
    const sheet = await listar(admin);
    expect(sheet.body.sampleStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // fronteira da amostra = último resume auditado
  });
});
