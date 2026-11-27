// Limite de envio dos formulários públicos (pedido de proposta e direito de resposta), com e sem proxy confiável (TRUSTED_PROXY_HOPS).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { dispatchCommercial } from './commercial';
import { dispatchEditorial } from './editorial';
import { makeApp } from './testkit';

vi.mock('../../../lib/portal-formularios', () => ({ formulariosAtivos: () => true }));

let app: Awaited<ReturnType<typeof makeApp>>;
let seq = 0;

const FORMULARIOS = [
  {
    nome: 'pedido de proposta', d: () => dispatchCommercial, path: '/api/commercial/leads',
    corpo: () => ({ nome: 'Ana Souza', empresa: 'Programa Alfa', email: `ana${++seq}@alfa.example`, formatosInteresse: [], objetivo: 'Divulgar a marca', optInNewsletter: false }),
  },
  {
    nome: 'direito de resposta', d: () => dispatchEditorial, path: '/api/editorial/right-of-reply',
    corpo: () => ({ articleId: 'art-limite', contested: `trecho contestado ${++seq}`, requester: { name: 'Fulana de Tal' }, contact: `f${seq}@exemplo.test`, replyText: 'Texto da resposta com mais de dez caracteres.' }),
  },
] as const;
const [LEAD, RESPOSTA] = FORMULARIOS;

/** POST com o X-Forwarded-For informado (null = sem cabeçalho). */
async function post(d: (r: Request) => Promise<Response>, path: string, body: unknown, xff: string | null): Promise<number> {
  const r = await d(new Request(`http://localhost:3000${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) }, body: JSON.stringify(body) }));
  return r.status;
}
const enviar = (f: (typeof FORMULARIOS)[number], xff: string | null) => post(f.d(), f.path, f.corpo(), xff);
async function emSerie(n: number, um: (i: number) => Promise<number>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await um(i));
  return out;
}

beforeAll(async () => {
  app = await makeApp();
  await app.db.insert(schema.articles).values({ id: 'art-limite', slug: 'materia-limite', titulo: 'Matéria publicada', editoria: 'pontos', corpo: 'Corpo.', resumo: 'Resumo.', status: 'publicado', publicadoEm: new Date('2026-11-20T10:00:00Z') });
}, 120_000);
afterAll(async () => { await app.close(); });
beforeEach(async () => { await app.db.delete(schema.authAttempt); app.clock.now = new Date('2026-11-22T12:00:00Z'); });
afterEach(() => { delete process.env.TRUSTED_PROXY_HOPS; });

describe('sem TRUSTED_PROXY_HOPS: teto único por formulário (30 por 15 min)', () => {
  for (const f of FORMULARIOS) {
    it(`${f.nome}: 30 passam, o 31º é 429 mesmo trocando o X-Forwarded-For; passada a janela, volta a aceitar`, async () => {
      expect(await emSerie(30, (i) => enviar(f, `203.0.113.${i + 1}`))).toEqual(Array(30).fill(201));
      expect(await enviar(f, '198.51.100.200')).toBe(429);
      expect(await enviar(f, null)).toBe(429);
      app.clock.now = new Date(app.clock.now.getTime() + 15 * 60_000 + 1_000);
      expect(await enviar(f, null)).toBe(201);
    }, 120_000);
  }

  it('um formulário esgotado não fecha o outro', async () => {
    await emSerie(30, () => enviar(LEAD, null));
    expect(await enviar(LEAD, null)).toBe(429);
    expect(await enviar(RESPOSTA, null)).toBe(201);
  }, 120_000);

  it('envios simultâneos não furam o teto', async () => {
    const st = await Promise.all(Array.from({ length: 40 }, () => enviar(LEAD, null)));
    expect(st.filter((s) => s === 201)).toHaveLength(30);
    expect(st.filter((s) => s === 429)).toHaveLength(10);
  }, 120_000);
});

describe('com TRUSTED_PROXY_HOPS=1: 5 por 15 min por IP', () => {
  for (const f of FORMULARIOS) {
    it(`${f.nome}: 5 passam, o 6º é 429; forjar o lado esquerdo não muda; outro IP passa`, async () => {
      process.env.TRUSTED_PROXY_HOPS = '1';
      expect(await emSerie(5, () => enviar(f, '203.0.113.50'))).toEqual(Array(5).fill(201));
      expect(await enviar(f, '203.0.113.50')).toBe(429);
      expect(await enviar(f, '9.9.9.9, 203.0.113.50')).toBe(429);
      expect(await enviar(f, '203.0.113.51')).toBe(201);
    });
  }

  it('requisição sem o cabeçalho do proxy cai no teto único (não fica sem limite)', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect((await emSerie(31, () => enviar(LEAD, null))).at(-1)).toBe(429);
  }, 120_000);

  it('anúncios (POST público que não é formulário) não são barrados nem gastam o limite do formulário do mesmo IP', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    const ip = '203.0.113.60';
    const serve = await emSerie(8, (i) => post(dispatchCommercial, '/api/commercial/ads/serve', { positionId: 'TOP', pageViewId: `pv-${i}` }, ip));
    expect(serve).toEqual(Array(8).fill(200));
    const evento = await emSerie(8, () => post(dispatchCommercial, '/api/commercial/ads/event', { impressionId: 'imp-x', event: 'visible' }, ip));
    expect(evento).not.toContain(429);
    expect(await app.db.$count(schema.authAttempt)).toBe(0);
    expect(await emSerie(5, () => enviar(LEAD, ip))).toEqual(Array(5).fill(201));
  });
});

describe('privacidade', () => {
  it('nenhum IP em claro em auth_attempt nem na auditoria, com e sem a variável', async () => {
    await enviar(LEAD, '203.0.113.99');
    process.env.TRUSTED_PROXY_HOPS = '1';
    for (const f of FORMULARIOS) await enviar(f, '203.0.113.99');
    const tentativas = await app.db.select().from(schema.authAttempt);
    expect(tentativas.length).toBe(3); // teto único do lead + um por IP em cada formulário
    for (const t of tentativas) expect(t.subject).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(JSON.stringify([tentativas, await app.db.select().from(schema.auditLog)])).not.toContain('203.0.113.99');
  });
});
