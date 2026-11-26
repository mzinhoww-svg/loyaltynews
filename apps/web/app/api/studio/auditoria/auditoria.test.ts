/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '@ln/auth';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import * as auditoria from './route';

// Leitura da trilha de auditoria no Studio: só admin e editor-chefe, IP só para o admin, filtros, paginação e a própria consulta auditada.
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let chefe: Actor;
let editor: Actor;
let leitor: Actor;

const get = (query: Record<string, string> = {}, as: Actor | null = admin) => call(auditoria.GET, 'GET', { path: '/api/studio/auditoria', query, as });

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor, leitor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'), await app.actor('leitor')];
  const at = (m: number) => new Date(app.clock.now.getTime() - m * 60_000);
  await audit(app.db as any, { actorId: 'u-1', actorRole: 'editor', action: 'materia.criada', resource: 'materia', resourceId: 'm1', ip: '203.0.113.7', detalhe: { titulo: 'x', senha: 'segredo-123' }, at: at(30) });
  await audit(app.db as any, { actorId: 'u-2', actorRole: 'admin', action: 'orcamento.kill_switch_acionado', resource: 'orcamento', resourceId: 'global', ip: '203.0.113.8', detalhe: { motivo: 'teste' }, at: at(20) });
  await audit(app.db as any, { actorId: 'u-2', actorRole: 'admin', action: 'orcamento.kill_switch_desligado', resource: 'orcamento', resourceId: 'global', at: at(10) });
  await audit(app.db as any, { actorId: 'u-3', actorRole: 'editor', action: 'materia_x.criada', resource: 'materia', resourceId: 'm2', at: at(5) }); // `_` não pode virar curinga
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('GET /api/studio/auditoria', () => {
  it('acesso: sem sessão 401; só senha MFA_REQUIRED; editor e leitor 403; admin e editor-chefe leem', async () => {
    expect((await get({}, null)).status).toBe(401);
    expect((await get({}, await app.passwordOnly('admin'))).body.error.code).toBe('MFA_REQUIRED');
    expect((await get({}, editor)).status).toBe(403);
    expect((await get({}, leitor)).status).toBe(403);
    expect((await get({}, admin)).status).toBe(200);
    expect((await get({}, chefe)).status).toBe(200);
  });

  it('ordem do mais novo ao mais velho, com total, limite e deslocamento', async () => {
    const r = await get({ resource: 'orcamento' });
    expect(r.body.data.map((x: any) => x.action)).toEqual(['orcamento.kill_switch_desligado', 'orcamento.kill_switch_acionado']);
    expect(r.body.total).toBe(2);
    const p1 = await get({ resource: 'orcamento', limit: '1' });
    const p2 = await get({ resource: 'orcamento', limit: '1', offset: '1' });
    expect([p1.body.data[0].action, p2.body.data[0].action]).toEqual(['orcamento.kill_switch_desligado', 'orcamento.kill_switch_acionado']);
    expect(p1.body).toMatchObject({ total: 2, limit: 1, offset: 0 });
  });

  it('filtros: ação exata, prefixo (sem curinga), autor, recurso+id e período', async () => {
    expect((await get({ action: 'materia.criada' })).body.data.map((x: any) => x.resourceId)).toEqual(['m1']);
    expect((await get({ actionPrefix: 'orcamento.' })).body.total).toBe(2);
    expect((await get({ actionPrefix: 'materia_' })).body.data.map((x: any) => x.action)).toEqual(['materia_x.criada']); // `_` literal: não casa 'materia.criada'
    expect((await get({ actorId: 'u-2' })).body.data).toHaveLength(2);
    expect((await get({ resource: 'materia', resourceId: 'm2' })).body.data).toHaveLength(1);
    const desde = new Date(app.clock.now.getTime() - 15 * 60_000).toISOString();
    expect((await get({ from: desde, resource: 'orcamento' })).body.data.map((x: any) => x.action)).toEqual(['orcamento.kill_switch_desligado']);
    expect((await get({ to: desde, resource: 'orcamento' })).body.data.map((x: any) => x.action)).toEqual(['orcamento.kill_switch_acionado']);
  });

  it('o IP só aparece para o admin; o editor-chefe vê null; segredo nunca esteve no detalhe', async () => {
    const a = (await get({ action: 'materia.criada' }, admin)).body.data[0];
    const c = (await get({ action: 'materia.criada' }, chefe)).body.data[0];
    expect(a.ip).toMatch(/^h1:[0-9a-f]{64}$/); // LGPD: o admin vê só o HMAC do IP (correlaciona eventos do mesmo IP), nunca o IP cru
    expect(JSON.stringify(a)).not.toContain('203.0.113.7');
    expect(c.ip).toBeNull();
    expect(a.detalhe).toEqual({ titulo: 'x', senha: '[removido]' });
    expect(JSON.stringify(c)).not.toContain('segredo-123');
  });

  it('parâmetros inválidos dão 400 (limite acima de 200, data ruim, offset negativo)', async () => {
    for (const q of [{ limit: '201' }, { limit: '0' }, { from: 'ontem' }, { offset: '-1' }] as Record<string, string>[]) expect((await get(q)).status, JSON.stringify(q)).toBe(400);
  });

  it('a própria consulta é auditada, com os filtros e sem o resultado', async () => {
    await get({ resource: 'orcamento' }, chefe);
    const logs = await app.db.select().from(schema.auditLog);
    const mine = logs.filter((l) => l.action === 'auditoria.consultada');
    expect(mine.length).toBeGreaterThan(0);
    const last = mine.at(-1)!;
    expect(last.resource).toBe('auditoria');
    expect(last.actorRole).toBe('editor_chefe');
    expect((last.detalhe as any).filtros.resource).toBe('orcamento');
    expect(JSON.stringify(last.detalhe)).not.toContain('kill_switch');
  });
});
