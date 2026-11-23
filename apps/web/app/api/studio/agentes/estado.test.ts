/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { PgCostLedger, PgHealthStore, PgLeaseQueue } from '@ln/workers/openbot-pg';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import { budgetGate } from '../../_lib/orcamento';
import * as agentes from './route';
import * as modelops from '../modelops/route';

// Estado real de agentes e ModelOps no Studio: configuração identificada como tal, estado vindo do PostgreSQL, acesso só admin/editor-chefe.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let chefe: Actor;
let editor: Actor;
let leitor: Actor;
const getA = (as: Actor | null) => call(agentes.GET, 'GET', { path: '/api/studio/agentes', as });
const getM = (as: Actor | null) => call(modelops.GET, 'GET', { path: '/api/studio/modelops', as });

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor, leitor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'), await app.actor('leitor')];
}, 120_000);
afterAll(async () => {
  app.deps.flags.openbotDispatch = false;
  await app.close();
});

describe('acesso', () => {
  it('sem sessão 401; só senha MFA_REQUIRED; editor e leitor 403; admin e editor-chefe leem (as duas rotas)', async () => {
    for (const get of [getA, getM]) {
      expect((await get(null)).status).toBe(401);
      expect((await get(await app.passwordOnly('admin'))).body.error.code).toBe('MFA_REQUIRED');
      expect((await get(editor)).status).toBe(403);
      expect((await get(leitor)).status).toBe(403);
      expect((await get(admin)).status).toBe(200);
      expect((await get(chefe)).status).toBe(200);
    }
  });
});

describe('GET /api/studio/agentes', () => {
  it('organização vem dos registros (64 perfis, 19 workflows, 28 rituais, 10 redações) e diz que é configuração; execução começa zerada de verdade', async () => {
    const d = (await getA(admin)).body.data;
    expect(d.organizacao).toMatchObject({ perfis: 64, workflows: 19, rituais: 28, redacoes: 10 });
    expect(d.organizacao.origem).toMatch(/configuração, não execução/);
    expect(d.organizacao.porDepartamento.reduce((s: number, x: any) => s + x.total, 0)).toBe(64);
    expect(d.organizacao.perfisHabilitados).toBeLessThanOrEqual(64);
    expect(d.execucao).toMatchObject({ reunioesExecutadas: 0, decisoes: 0, itensDeAcao: 0, memoriaSetorial: 0, ultimaExecucaoEm: null, flagRituais: false });
  });

  it('execuções gravadas aparecem na contagem e por status', async () => {
    await app.db.insert(schema.meetingRuns).values({
      id: crypto.randomUUID(), meetingId: 'D-pontos', localDate: '2026-11-22', scheduledFor: new Date('2026-11-22T11:00:00Z'), executedAt: new Date('2026-11-22T11:01:00Z'),
      status: 'completed', route: 'economy', chair: 'editor_pontos', quorumMinimum: 1,
    } as any);
    const d = (await getA(chefe)).body.data.execucao;
    expect(d.reunioesExecutadas).toBe(1);
    expect(d.porStatus).toEqual([{ status: 'completed', total: 1 }]);
    expect(d.ultimaExecucaoEm).toBe('2026-11-22T11:01:00.000Z');
  });

  it('OpenBot: sem contato até o primeiro pull; fila, custo do mês e flag/parada refletem o banco', async () => {
    let o = (await getA(admin)).body.data.openbot;
    expect(o.saude.status).toBe('sem_contato');
    expect(o).toMatchObject({ despachoLigado: false, parada: false, fila: { pending: 0, leased: 0, completed: 0, failed: 0, dead: 0 } });
    const q = new PgLeaseQueue(app.db as any);
    const t = (await q.enqueue({ kind: 'editorial_draft', profileId: 'writer_pontos', refId: 'art-1', idempotencyKey: 'i-1', dataClass: 'public', maxCostMicro: 5_000_000 }, app.clock.now)).task;
    await new PgHealthStore(app.db as any).markPull('w1', app.clock.now);
    await new PgCostLedger(app.db as any, app.deps.now).record({ executionId: 'e1', taskId: t.id, leaseId: 'l1', model: 'm', generationIds: ['g'], promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicro: 42_000_000 }, 5_000_000, app.clock.now);
    app.deps.flags.openbotDispatch = true;
    o = (await getA(admin)).body.data.openbot;
    expect(o.saude.status).toBe('saudavel');
    expect(o.fila.pending).toBe(1);
    expect(o).toMatchObject({ despachoLigado: true, custoDoMes: { totalMicro: 42_000_000, situacao: 'alerta' } });
  });
});

describe('GET /api/studio/modelops', () => {
  it('política: versão, produção desligada, modelos com exclusões e qualificação desligada; diz de onde vem e que a aprovação não consta', async () => {
    const d = (await getM(admin)).body.data;
    expect(d.politica.origem).toMatch(/aprovação em vigor é decisão do proprietário/);
    expect(d.politica).toMatchObject({ producaoHabilitada: false, tetoMensalUsd: 50 });
    expect(typeof d.politica.versao).toBe('string');
    expect(d.politica.modelos.length).toBeGreaterThan(0);
    expect(d.politica.modelos.every((m: any) => typeof m.id === 'string' && typeof m.provedor === 'string')).toBe(true);
    expect(d.flags).toEqual({ modelosHabilitados: false, openbotDispatch: expect.any(Boolean) });
    expect(d.politica.qualificacao === null || d.politica.qualificacao.ligada === false).toBe(true); // como entregue: desligada
  });

  it('consumo e parada vêm do ledger canônico no PostgreSQL', async () => {
    const before = (await getM(chefe)).body.data;
    expect(before.consumo).toMatchObject({ totalMicro: 0, reservasAbertas: 0, reservasPendentes: 0 });
    expect(before.parada.global.engaged).toBe(false);
    const r = await budgetGate(app.db).reserve({ taskId: 'editorial_draft', taskClass: 'essential', lane: 'text', provider: 'anthropic', model: 'm', escalation: false, amountUsd: 2, at: app.clock.now } as any);
    expect(r.ok).toBe(true);
    const after = (await getM(chefe)).body.data;
    expect(after.consumo).toMatchObject({ totalMicro: 2_000_000, reservasAbertas: 1, tetoMicro: 50_000_000 });
    expect(after.consumo.gastoPorProvedorMicro).toEqual({ anthropic: 2_000_000 });
    expect(after.consumo.origem).toMatch(/PostgreSQL/);
  });
});
