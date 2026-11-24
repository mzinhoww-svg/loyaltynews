/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { PgPilotResolutionStore, PgPilotRowStore, PgPilotStateStore } from '@ln/workers/openbot-pg';
import type { PilotRow } from '@ln/openbot';
import { call, makeApp, type Actor } from '../../../../_lib/testkit';
import * as resolve from './[taskId]/[attempt]/resolve/route';
import * as resume from '../resume/route';
import * as linhas from '../../piloto/linhas/route';

// Decisão PM-2026-11-23-D: o admin TRATA uma violação do piloto (libera despacho e retomada), sem apagar a linha, e a violação continua contando no critério de 0 violações.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let chefe: Actor;
let editor: Actor;
const MOTIVO = 'Segredo rotacionado e log apagado na origem; chave antiga revogada.';
const row = (taskId: string, attempt: number, over: Partial<PilotRow> = {}): PilotRow =>
  ({
    task_id: taskId, kind: 'editorial_draft', article_id: 'art-1', source_id: 's1', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet-5-5', prompt_version: 'p1',
    started_at: '2026-11-23T12:00:00.000Z', ended_at: '2026-11-23T12:01:00.000Z', attempt, outcome: 'completed', packet_chars: 100, tokens_measured: false,
    published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  }) as PilotRow;
const resolver = (taskId: string, attempt: string, as: Actor | null, body: unknown = { motivo: MOTIVO, acaoTomada: 'segredo_rotacionado' }) =>
  call(resolve.POST as never, 'POST', { path: `/api/studio/openbot/pilot/rows/${taskId}/${attempt}/resolve`, as, params: { taskId, attempt } as never, body });
const retomar = (as: Actor | null) => call(resume.POST as never, 'POST', { path: '/api/studio/openbot/pilot/resume', as, body: {} });
const listar = (as: Actor | null) => call(linhas.GET as never, 'GET', { path: '/api/studio/openbot/piloto/linhas', as });
const rows = () => new PgPilotRowStore(app.db as any, app.deps.now);
const state = () => new PgPilotStateStore(app.db as any);

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor')];
  await rows().upsert(row('violation-1', 1, { secret_in_log: true, stage: 'rights_seo_qa', account: 'deterministic' as never }));
  await rows().upsert(row('violation-2', 1, { published_attempt: true }));
  await rows().upsert(row('t-ok', 1, { stage: 'draft' }));
});
afterEach(() => {
  delete process.env.APP_ENV;
  delete process.env.LN_OPENBOT_PILOT;
});
afterAll(async () => app.close());

describe('POST /api/studio/openbot/pilot/rows/:taskId/:attempt/resolve', () => {
  it('só admin: sem sessão 401, editor-chefe 403, editor 403; ids inválidos 400; linha inexistente 404', async () => {
    expect((await resolver('violation-1', '1', null)).status).toBe(401);
    expect((await resolver('violation-1', '1', chefe)).status).toBe(403);
    expect((await resolver('violation-1', '1', editor)).status).toBe(403);
    expect((await resolver('violation-1', 'x', admin)).status).toBe(400);
    expect((await resolver('id com espaço', '1', admin)).status).toBe(400);
    expect((await resolver('nao-existe', '1', admin)).status).toBe(404);
  });

  it('corpo inválido (motivo curto ou sem ação) 400; linha SEM violação 409 NOT_A_VIOLATION; segredo exige segredo_rotacionado 409 ACTION_REQUIRED', async () => {
    expect((await resolver('violation-1', '1', admin, { motivo: 'curto', acaoTomada: 'segredo_rotacionado' })).status).toBe(400);
    expect((await resolver('violation-1', '1', admin, { motivo: MOTIVO })).status).toBe(400);
    expect((await resolver('t-ok', '1', admin)).body.error.code).toBe('NOT_A_VIOLATION');
    expect((await resolver('violation-1', '1', admin, { motivo: MOTIVO, acaoTomada: 'ignorar' })).body.error.code).toBe('ACTION_REQUIRED');
    expect(await new PgPilotResolutionStore(app.db as any).all()).toEqual([]); // nada gravado pelas recusas
  });

  it('o admin trata: 201 com quem, quando, motivo e ação; repetir = 200 jaResolvida (a original); a linha NÃO muda; auditada', async () => {
    const antes = (await rows().all()).find((r) => r.task_id === 'violation-1')!;
    const r = await resolver('violation-1', '1', admin);
    expect(r).toMatchObject({ status: 201, body: { taskId: 'violation-1', attempt: 1, violacoes: ['secret_in_log'], jaResolvida: false, tratada: { por: admin.id, motivo: MOTIVO, acao: 'segredo_rotacionado' } } });
    const de = await resolver('violation-1', '1', admin, { motivo: 'Outro motivo com tamanho suficiente.', acaoTomada: 'segredo_rotacionado' });
    expect(de).toMatchObject({ status: 200, body: { jaResolvida: true, tratada: { motivo: MOTIVO } } }); // a primeira vence
    expect((await rows().all()).find((x) => x.task_id === 'violation-1')).toEqual(antes); // a linha da planilha é intocada
    expect((await app.db.select().from(schema.auditLog)).some((l: any) => l.action === 'openbot.piloto_linha_resolvida' && l.actorId === admin.id)).toBe(true);
  });
});

describe('retomada e planilha depois do tratamento', () => {
  it('com a violação 2 ainda NÃO tratada a retomada é recusada (409) e a parada fica; tratada a 2, retoma (200) e a violação 1 segue na planilha', async () => {
    Object.assign(process.env, { APP_ENV: 'staging', LN_OPENBOT_PILOT: '1' });
    await state().stop('segredo em log', app.clock.now.toISOString());
    const r1 = await retomar(admin);
    expect(r1).toMatchObject({ status: 409, body: { error: { code: 'PILOT_STILL_INVALID' } } });
    expect(JSON.stringify(r1.body)).toContain('violation-2'); // só a não tratada é citada
    expect(JSON.stringify(r1.body)).not.toContain('violation-1');
    expect(await state().get()).not.toBeNull();
    expect((await resolver('violation-2', '1', admin, { motivo: 'Tentativa de publicar bloqueada na origem; sem efeito.', acaoTomada: 'bloqueio_confirmado' })).status).toBe(201);
    expect(await retomar(admin)).toMatchObject({ status: 200, body: { resumed: true } });
    expect(await state().get()).toBeNull();
  });

  it('a planilha continua mostrando TODAS as linhas; as tratadas levam `tratada` (por, em, motivo, ação) e as demais não', async () => {
    const r = await listar(chefe);
    expect(r.status).toBe(200);
    const por = (id: string) => r.body.items.find((x: any) => x.task_id === id);
    expect(r.body.items).toHaveLength(3);
    expect(por('violation-1')).toMatchObject({ secret_in_log: true, tratada: { por: admin.id, acao: 'segredo_rotacionado', motivo: MOTIVO } });
    expect(por('violation-2')).toMatchObject({ published_attempt: true, tratada: { acao: 'bloqueio_confirmado' } });
    expect(por('t-ok')).not.toHaveProperty('tratada');
    expect(por('violation-1').tratada.em).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
