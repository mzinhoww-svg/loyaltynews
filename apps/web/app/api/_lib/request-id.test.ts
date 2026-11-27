// Parecer do QA 6 sobre os limites (F1): o x-request-id é texto de quem chama e não pode levar e-mail a log, resposta ou auditoria; o aviso do teto não pode inundar o log.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { schema } from '@ln/db';
import { dispatchCommercial } from './commercial';
import { dispatchEditorial } from './editorial';
import { execute, requestIdDe } from './http';
import { dispatchTitular } from './titular-studio';
import { makeApp, type Actor } from './testkit';

vi.mock('../../../lib/portal-formularios', () => ({ formulariosAtivos: () => true }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = 'qa6-cabecalho@example.invalid';
const RUINS = [EMAIL, 'qa6-cabecalho%40example.invalid', 'Maria da Silva', 'maria.silva', 'x'.repeat(500), '12345678-1234-4123-8123-123456789abc extra', `12345678-1234-4123-8123-123456789abc-${EMAIL}`, ''];

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let logs: MockInstance[];
let dia = 0;

beforeAll(async () => { app = await makeApp(); admin = await app.actor('admin'); }, 120_000);
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  delete process.env.TRUSTED_PROXY_HOPS;
  await app.db.delete(schema.authAttempt);
  app.clock.now = new Date(Date.UTC(2026, 11, ++dia, 12)); // cada teste num dia: o aviso é limitado por janela de tempo
  logs = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});
afterEach(() => { for (const l of logs) l.mockRestore(); });

const escrito = () => JSON.stringify(logs.flatMap((l) => l.mock.calls));
const avisos = () => logs[2]!.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('teto sem IP'));
const post = (d: (r: Request) => Promise<Response>, path: string, headers: Record<string, string> = {}) =>
  d(new Request(`http://localhost:3000${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: 'JSON inválido' }));
const lead = (headers?: Record<string, string>) => post(dispatchCommercial, '/api/commercial/leads', headers);
const resposta = (headers?: Record<string, string>) => post(dispatchEditorial, '/api/editorial/right-of-reply', headers);
const esgotar = async (um: () => Promise<Response>) => { for (let i = 0; i < 30; i++) expect((await um()).status).toBe(400); };

describe('x-request-id com formato fechado', () => {
  it('só UUID é aceito; qualquer outro valor é trocado por um UUID novo', () => {
    const req = (v?: string) => new Request('http://localhost:3000/api/x', { headers: v === undefined ? {} : { 'x-request-id': v } });
    for (const bom of ['12345678-1234-4123-8123-123456789abc', 'ABCDEF01-1234-4123-8123-123456789ABC']) expect(requestIdDe(req(bom))).toBe(bom);
    for (const ruim of RUINS) { const id = requestIdDe(req(ruim)); expect(id, ruim).toMatch(UUID); expect(id).not.toBe(ruim); }
    expect(requestIdDe(req())).toMatch(UUID);
  });

  it('formulário recusado pelo teto: o endereço no cabeçalho não vai ao log, à resposta nem ao corpo', async () => {
    await esgotar(() => lead());
    const r = await lead({ 'x-request-id': EMAIL });
    expect(r.status).toBe(429);
    expect(avisos()).toHaveLength(1);
    expect(escrito()).not.toContain(EMAIL);
    const corpo = await r.text();
    expect(corpo).not.toContain(EMAIL);
    expect(r.headers.get('x-request-id')).toMatch(UUID);
    expect(JSON.parse(corpo).error.requestId).toBe(r.headers.get('x-request-id'));
  });

  it('erro interno: a linha de erro não leva o cabeçalho', async () => {
    const r = await execute(new Request('http://localhost:3000/api/x', { headers: { 'x-request-id': EMAIL } }), 'public', async () => { throw new Error('falha'); });
    expect(r.status).toBe(500);
    expect(logs[3]!.mock.calls).toHaveLength(1);
    expect(escrito()).not.toContain(EMAIL);
  });

  it('rota própria do titular: nem a resposta nem a auditoria recebem o cabeçalho', async () => {
    const r = await dispatchTitular(new Request('http://localhost:3000/api/studio/correcoes/nao-existe', { headers: { cookie: admin.cookie, 'x-request-id': EMAIL } }), { params: Promise.resolve({ path: ['nao-existe'] }) });
    expect(r.status).toBe(404);
    expect(r.headers.get('x-request-id')).toMatch(UUID);
    expect(await r.text()).not.toContain(EMAIL);
    expect(escrito()).not.toContain(EMAIL);
  });
});

describe('aviso do teto sem IP com emissão limitada', () => {
  it('200 recusas viram 1 linha; passados 15 min sai outra, com a contagem; cada formulário tem o seu', async () => {
    await esgotar(() => lead());
    for (let i = 0; i < 200; i++) expect((await lead({ 'x-request-id': `r${i}` })).status).toBe(429);
    expect(avisos()).toEqual(['[api] teto sem IP atingido em /api/commercial/leads (recusas desde o aviso anterior: 1)']);

    await esgotar(() => resposta());
    expect((await resposta()).status).toBe(429);
    expect((await resposta()).status).toBe(429);
    expect(avisos()).toHaveLength(2);

    app.clock.now = new Date(app.clock.now.getTime() + 15 * 60_000 + 1_000);
    await esgotar(() => lead()); // a janela do limite reabriu
    expect((await lead()).status).toBe(429);
    expect(avisos()[2]).toBe('[api] teto sem IP atingido em /api/commercial/leads (recusas desde o aviso anterior: 200)');
    expect(avisos()).toHaveLength(3);
  }, 120_000);
});
