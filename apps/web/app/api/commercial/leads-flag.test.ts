import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';

// POST /api/commercial/leads (pedido de proposta do mídia kit) só existe com a flag portalFormularios ligada, lida em EXECUÇÃO pelo
// mesmo helper do portal (formulariosAtivos). Desligada: 404 igual ao de uma rota inexistente, antes do limite por IP e de ler o corpo.
const estado = vi.hoisted(() => ({ ligada: false }));
vi.mock('../../../lib/portal-formularios', () => ({ formulariosAtivos: () => estado.ligada }));

let app: Awaited<ReturnType<typeof makeApp>>;
const P = '/api/commercial/leads';
const corpo = (email = 'ana@alfa.example') => ({ nome: 'Ana Souza', empresa: 'Programa Alfa', email, formatosInteresse: [], objetivo: 'Divulgar a marca', optInNewsletter: false });
const leads = () => app.db.$count(schema.crmLeads);
const tentativas = () => app.db.$count(schema.authAttempt);

beforeAll(async () => { app = await makeApp(); }, 120_000);
afterAll(async () => { await app.close(); });
beforeEach(() => { estado.ligada = false; });

describe('pedido de proposta no servidor, nos dois estados da flag', () => {
  it('desligada: 404 NOT_FOUND como uma rota inexistente; nada é gravado e nenhuma tentativa por IP é contada', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1'; // com IP de proxy confiável o limite por IP gravaria uma linha em auth_attempt
    try {
      const antesLeads = await leads(); const antesTentativas = await tentativas();
      const r = await call(d, 'POST', { path: P, body: corpo() });
      expect(r.status).toBe(404);
      const inexistente = await call(d, 'POST', { path: '/api/commercial/nada', body: corpo() });
      expect(inexistente.status).toBe(404);
      // mesma resposta (código e mensagem; só o id da requisição muda): a rota fechada não se distingue de uma que não existe
      expect({ ...r.body.error, requestId: undefined }).toEqual({ ...inexistente.body.error, requestId: undefined });
      expect(r.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Rota inexistente.' });
      expect(await leads()).toBe(antesLeads);
      expect(await tentativas()).toBe(antesTentativas);
    } finally { delete process.env.TRUSTED_PROXY_HOPS; }
  });
  it('desligada: corpo inválido também recebe 404 (o corpo nem é lido), não 400', async () => {
    expect((await call(d, 'POST', { path: P, body: { email: 'não-é-email', campoExtra: 1 } })).status).toBe(404);
  });
  it('ligada: 201 e o lead é gravado', async () => {
    estado.ligada = true;
    const antes = await leads();
    const r = await call(d, 'POST', { path: P, body: corpo('bia@beta.example') });
    expect(r.status).toBe(201);
    expect(await leads()).toBe(antes + 1);
  });
  it('a flag é lida a cada requisição: ligar e desligar vale na chamada seguinte, sem recriar nada', async () => {
    for (const [ligada, esperado] of [[true, 201], [false, 404], [true, 201], [false, 404]] as const) {
      estado.ligada = ligada;
      expect((await call(d, 'POST', { path: P, body: corpo(`x${Math.random().toString(36).slice(2)}@z.example`) })).status, String(ligada)).toBe(esperado);
    }
  });
  it('ligada, o limite por IP e a validação seguem valendo', async () => {
    estado.ligada = true;
    expect((await call(d, 'POST', { path: P, body: { ...corpo('c@c.example'), campoExtra: 1 } })).status).toBe(400);
  });
  it('só fecha o pedido de proposta: o resto do comercial público segue aberto com a flag desligada', async () => {
    for (const p of ['/api/commercial/mediakit', '/api/commercial/formats']) expect((await call(d, 'GET', { path: p })).status, p).toBe(200);
    const ads = await call(d, 'POST', { path: '/api/commercial/ads/serve', body: { positionId: 'TOP', pageViewId: 'pv-flag' } });
    expect(ads.status).toBe(200);
  });
  it('o CRM do Studio grava o lead pela rota autenticada com a flag do portal desligada', async () => {
    const comercial = await app.actor('comercial');
    const antes = await leads();
    const r = await call(d, 'POST', { path: '/api/commercial/studio/leads', body: corpo('studio@example.test'), as: comercial });
    expect(r.status).toBe(201);
    expect(await leads()).toBe(antes + 1);
  });
  it('a rota de Studio do lead exige sessão: sem login é 401, nunca pública', async () => {
    const antes = await leads();
    expect((await call(d, 'POST', { path: '/api/commercial/studio/leads', body: corpo('sem@login.test') })).status).toBe(401);
    expect(await leads()).toBe(antes);
  });
  it('a rota de Studio do lead exige MFA: só senha responde 403 e não grava', async () => {
    const antes = await leads();
    const soSenha = await app.passwordOnly('comercial');
    const r = await call(d, 'POST', { path: '/api/commercial/studio/leads', body: corpo('sem-mfa@example.test'), as: soSenha });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_REQUIRED');
    expect(await leads()).toBe(antes);
  });
});
