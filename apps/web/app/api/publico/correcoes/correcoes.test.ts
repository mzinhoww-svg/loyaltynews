import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import { call, makeApp } from '../../_lib/testkit';
import { MAX_PEDIDOS_ABERTOS } from '../../_lib/titular';
import * as correcoes from './route';

let app: Awaited<ReturnType<typeof makeApp>>;
let seq = 0;
const pedido = (over: Record<string, unknown> = {}) => ({
  nome: 'Maria Titular', contato: `titular${++seq}@example.org`, url: 'https://loyaltynews.example/intelligence/pessoas/maria',
  tipo: 'correcao', texto: 'Meu cargo atual está desatualizado desde março.', ...over,
});
const enviar = (body: unknown) => call(correcoes.POST, 'POST', { path: '/api/publico/correcoes', body });
const rows = () => app.db.select().from(schema.titularPedidos);
const audits = () => app.db.select().from(schema.auditLog).where(eq(schema.auditLog.resource, 'titular_pedidos'));

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => app.close());

describe('POST /api/publico/correcoes (canal do titular, DP-38)', () => {
  it('sem sessão: grava na fila como recebido, audita só id e tipo, responde 202 sem id nem eco de dados', async () => {
    const body = pedido({ tipo: 'remocao', contato: 'Maria.Titular@Example.org' });
    const r = await enviar(body);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'recebido' });
    const txt = JSON.stringify(r.body);
    for (const v of ['Maria', 'example.org', 'loyaltynews', 'cargo']) expect(txt).not.toContain(v);
    const [row] = (await rows()).filter((x) => x.contato === 'maria.titular@example.org');
    expect(row).toMatchObject({ tipo: 'remocao', estado: 'recebido', nome: 'Maria Titular', url: body.url });
    const [a] = (await audits()).filter((x) => x.resourceId === row!.id);
    expect(a).toMatchObject({ action: 'titular.pedido_recebido', ip: null, actorId: null });
    const det = JSON.stringify(a!.detalhe);
    expect(det).toContain('remocao');
    for (const v of ['Maria', 'example.org', 'loyaltynews', 'cargo']) expect(det).not.toContain(v);
  });

  it('validação: tipo só correcao|remocao, e-mail, URL http(s), texto mínimo; erro não ecoa o valor', async () => {
    for (const over of [{ tipo: 'outro' }, { contato: 'nao-e-email' }, { url: 'javascript:alert(1)' }, { url: 'ftp://x.example/a' }, { texto: 'curto' }, { nome: '' }]) {
      const r = await enviar(pedido(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    const r = await enviar(pedido({ contato: 'segredo-nao-ecoar' }));
    expect(JSON.stringify(r.body)).not.toContain('segredo-nao-ecoar');
  });

  it('honeypot: 202 igual e nada gravado', async () => {
    const antes = (await rows()).length;
    const r = await enviar(pedido({ site: 'http://spam.example' }));
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'recebido' });
    expect((await rows()).length).toBe(antes);
  });

  it('pedido idêntico em aberto: mesma resposta, sem linha nova nem auditoria nova', async () => {
    const body = pedido();
    expect((await enviar(body)).status).toBe(202);
    const n = (await rows()).length;
    const na = (await audits()).length;
    const r = await enviar(body);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'recebido' });
    expect((await rows()).length).toBe(n);
    expect((await audits()).length).toBe(na);
  });

  it('limite por contato: 5 por 15 min, depois 429 (mesmo trocando o texto)', async () => {
    const contato = 'repetido@example.org';
    const st = [];
    for (let i = 0; i < 7; i++) st.push((await enviar(pedido({ contato, texto: `Pedido número ${i} de teste de limite.` }))).status);
    expect(st.filter((s) => s === 202)).toHaveLength(5);
    expect(st.filter((s) => s === 429)).toHaveLength(2);
  });

  it('limite por IP (com proxy confiável): 5 por 15 min, depois 429', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    try {
      const st = [];
      for (let i = 0; i < 7; i++) st.push((await enviar(pedido())).status);
      expect(st.filter((s) => s === 202)).toHaveLength(5);
      expect(st.filter((s) => s === 429)).toHaveLength(2);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  it(`teto de ${MAX_PEDIDOS_ABERTOS} em aberto: 429 FILA_CHEIA`, async () => {
    const faltam = MAX_PEDIDOS_ABERTOS - (await rows()).filter((x) => x.estado === 'recebido').length;
    const now = new Date();
    const vals = Array.from({ length: faltam }, (_, i) => ({
      id: `cheia-${i}`, tipo: 'correcao', estado: 'recebido', nome: 'X', contato: `c${i}@x.example`, url: 'https://x.example', texto: 'enchimento de fila',
      chaveDedupe: `chave-${i}`, recebidoEm: now, atualizadoEm: now, prazoEm: now,
    }));
    for (let i = 0; i < vals.length; i += 100) await app.db.insert(schema.titularPedidos).values(vals.slice(i, i + 100));
    const r = await enviar(pedido());
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('FILA_CHEIA');
  });

  it('o banco recusa tipo ou estado fora da lista', async () => {
    const now = new Date();
    const base = { nome: 'X', contato: 'x@x.example', url: 'https://x.example', texto: 'xxxxxxxxxx', recebidoEm: now, atualizadoEm: now, prazoEm: now };
    await expect(app.db.insert(schema.titularPedidos).values({ ...base, id: 'bad1', tipo: 'apagar', chaveDedupe: 'b1' })).rejects.toThrow();
    await expect(app.db.insert(schema.titularPedidos).values({ ...base, id: 'bad2', tipo: 'correcao', estado: 'publicado', chaveDedupe: 'b2' })).rejects.toThrow();
  });
});
