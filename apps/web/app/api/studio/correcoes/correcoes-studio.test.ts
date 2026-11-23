import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import { PRAZO_DIAS, alvoDaUrl } from '../../_lib/titular';
import * as publico from '../../publico/correcoes/route';
import * as fila from './[[...path]]/route';

let app: Awaited<ReturnType<typeof makeApp>>;
let chefe: Actor;
let admin: Actor;
let editor: Actor;
let leitor: Actor;
let seq = 0;

const enviar = (over: Record<string, unknown> = {}) =>
  call(publico.POST, 'POST', {
    path: '/api/publico/correcoes',
    body: {
      nome: 'Titular Teste', contato: `t${++seq}@example.org`, url: `https://ln.example/intelligence/pessoas/p-${seq}`,
      tipo: 'correcao', texto: `Pedido de teste número ${seq} com texto suficiente.`, ...over,
    },
  });
const req = (method: string, path: string[], as: Actor | null, opts: { body?: unknown; query?: Record<string, string> } = {}) =>
  call(fila.GET as never, method, { path: `/api/studio/correcoes/${path.join('/')}`, as, params: { path } as never, ...opts });
const idPorContato = async (contato: string) => (await app.db.select().from(schema.titularPedidos).where(eq(schema.titularPedidos.contato, contato)))[0]!.id;
const novo = async (over: Record<string, unknown> = {}) => {
  const contato = `n${++seq}@example.org`;
  expect((await enviar({ contato, ...over })).status).toBe(202);
  return idPorContato(contato);
};
const postar = (method: string, path: string[], as: Actor | null, body: unknown) =>
  call(fila.POST as never, method, { path: `/api/studio/correcoes/${path.join('/')}`, as, params: { path } as never, body });

beforeAll(async () => {
  app = await makeApp();
  [chefe, admin, editor, leitor] = [await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('editor'), await app.actor('leitor')];
});
afterAll(async () => app.close());

describe('alvo e prazo na entrada pública', () => {
  it('alvoDaUrl: pessoa, cargo, move, nada', () => {
    expect(alvoDaUrl('https://x.example/intelligence/pessoas/p-1')).toEqual({ tipo: 'pessoa', id: 'p-1' });
    expect(alvoDaUrl('https://x.example/intelligence/pessoas/p-1?cargo=c-9')).toEqual({ tipo: 'cargo', id: 'c-9' });
    expect(alvoDaUrl('https://x.example/intelligence/moves/m-2')).toEqual({ tipo: 'move', id: 'm-2' });
    expect(alvoDaUrl('https://x.example/noticia/abc')).toBeNull();
    expect(alvoDaUrl('https://x.example/pessoas/%E0%A4%A')).toBeNull();
  });
  it(`prazo_em = recebido_em + ${PRAZO_DIAS} dias`, async () => {
    const id = await novo();
    const [r] = await app.db.select().from(schema.titularPedidos).where(eq(schema.titularPedidos.id, id));
    expect(r!.prazoEm.getTime() - r!.recebidoEm.getTime()).toBe(PRAZO_DIAS * 86_400_000);
    expect(r).toMatchObject({ alvoTipo: 'pessoa' });
  });
});

describe('fila do titular no Studio (DP-38)', () => {
  it('RBAC: editor, leitor e anônimo não acessam; editor-chefe e admin sim', async () => {
    const id = await novo();
    for (const as of [editor, leitor]) {
      expect((await req('GET', [], as)).status).toBe(403);
      expect((await req('GET', [id], as)).status).toBe(403);
      expect((await postar('POST', [id, 'decidir'], as, { acao: 'negar', motivo: 'sem base' })).status).toBe(403);
    }
    expect((await req('GET', [], null)).status).toBe(401);
    expect((await req('GET', [], chefe)).status).toBe(200);
    expect((await req('GET', [], admin)).status).toBe(200);
  });

  it('lista sem nome e contato; filtro por estado; detalhe com texto, contato e trilha (consulta auditada)', async () => {
    const contato = `lista${++seq}@example.org`;
    await enviar({ contato, tipo: 'remocao', url: 'https://ln.example/intelligence/moves/m-77' });
    const id = await idPorContato(contato);
    const l = await req('GET', [], chefe, { query: { estado: 'recebido' } });
    const it = l.body.items.find((x: { id: string }) => x.id === id);
    expect(it).toMatchObject({ estado: 'recebido', pedido: 'remocao', responsavel: null, alvo: { tipo: 'move', id: 'm-77', nome: null } });
    expect(JSON.stringify(l.body)).not.toContain(contato);
    expect(JSON.stringify(l.body)).not.toContain('Titular Teste');
    expect(l.body.items.every((x: { estado: string }) => x.estado === 'recebido')).toBe(true);
    const d = await req('GET', [id], chefe);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ id, contato, nome: 'Titular Teste' });
    expect(d.body.texto.length).toBeGreaterThan(10);
    const acoes = d.body.auditoria.map((a: { acao: string }) => a.acao);
    expect(acoes).toContain('titular.pedido_recebido');
    expect(acoes).toContain('titular.pedido_consultado');
    expect((await req('GET', ['nao-existe'], chefe)).status).toBe(404);
  });

  it('atribuir: só a editor-chefe/admin; vai para em_analise e audita', async () => {
    const id = await novo();
    expect((await postar('POST', [id, 'atribuir'], chefe, { responsavel: editor.id })).status).toBe(422);
    expect((await postar('POST', [id, 'atribuir'], chefe, { responsavel: 'ninguem' })).status).toBe(422);
    const r = await postar('POST', [id, 'atribuir'], chefe, { responsavel: admin.id });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'em_analise', responsavel: admin.id });
    const f = await req('GET', [], chefe, { query: { responsavel: admin.id } });
    expect(f.body.items.map((x: { id: string }) => x.id)).toContain(id);
  });

  it('decidir: corrigir, remover_cargo, remover_pessoa, negar; 409 depois; negar exige motivo; trilha com ator e motivo', async () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ acao: 'corrigir', campos: { cargo: 'Diretora de Fidelização' } }, 'corrigido'],
      [{ acao: 'remover_cargo' }, 'removido'],
      [{ acao: 'remover_pessoa', motivo: 'pedido do titular' }, 'removido'],
      [{ acao: 'negar', motivo: 'cargo confirmado em fonte oficial' }, 'negado'],
    ];
    for (const [body, estado] of casos) {
      const id = await novo();
      const r = await postar('POST', [id, 'decidir'], chefe, body);
      expect(r.status, JSON.stringify(body)).toBe(200);
      expect(r.body).toMatchObject({ estado, decidido_por: chefe.id, efeitoPublico: 'pendente', decisao: { acao: body.acao } });
      const again = await postar('POST', [id, 'decidir'], admin, { acao: 'negar', motivo: 'tarde demais' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ALREADY_DECIDED');
      expect((await postar('POST', [id, 'atribuir'], chefe, { responsavel: admin.id })).status).toBe(409);
      const d = await req('GET', [id], admin);
      const dec = d.body.auditoria.find((a: { acao: string }) => a.acao === 'titular.pedido_decidido');
      expect(dec).toMatchObject({ ator: chefe.id });
      if (body.motivo) expect(dec.motivo).toBe(body.motivo);
    }
    const id = await novo();
    expect((await postar('POST', [id, 'decidir'], chefe, { acao: 'negar' })).status).toBe(400);
    expect((await postar('POST', [id, 'decidir'], chefe, { acao: 'corrigir', campos: {} })).status).toBe(400);
    expect((await postar('POST', [id, 'decidir'], chefe, { acao: 'apagar' })).status).toBe(400);
  });

  it('decidir é atômico: duas decisões simultâneas, só uma vence', async () => {
    const id = await novo();
    const [a, b] = await Promise.all([
      postar('POST', [id, 'decidir'], chefe, { acao: 'remover_pessoa' }),
      postar('POST', [id, 'decidir'], admin, { acao: 'negar', motivo: 'concorrência' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('rota desconhecida: 404', async () => {
    const id = await novo();
    expect((await postar('POST', [id, 'apagar'], chefe, {})).status).toBe(404);
  });
});

describe('efeitosTitular (contrato com as rotas públicas)', () => {
  it('remover_pessoa, remover_cargo, move e corrigir viram conjuntos; negado e sem alvo não', async () => {
    const { efeitosTitular } = await import('../../_lib/titular-efeito');
    const pes = await novo({ url: 'https://ln.example/intelligence/pessoas/ef-p1' });
    const car = await novo({ url: 'https://ln.example/intelligence/pessoas/ef-p2?cargo=ef-c1' });
    const mov = await novo({ url: 'https://ln.example/intelligence/moves/ef-m1' });
    const cor = await novo({ url: 'https://ln.example/intelligence/pessoas/ef-p3' });
    const neg = await novo({ url: 'https://ln.example/intelligence/pessoas/ef-p4' });
    const sem = await novo({ url: 'https://ln.example/noticia/x' });
    await postar('POST', [pes, 'decidir'], chefe, { acao: 'remover_pessoa' });
    await postar('POST', [car, 'decidir'], chefe, { acao: 'remover_cargo' });
    await postar('POST', [mov, 'decidir'], chefe, { acao: 'remover_pessoa' });
    await postar('POST', [cor, 'decidir'], chefe, { acao: 'corrigir', campos: { cargo: 'CEO' } });
    await postar('POST', [neg, 'decidir'], chefe, { acao: 'negar', motivo: 'fonte oficial confirma' });
    await postar('POST', [sem, 'decidir'], chefe, { acao: 'remover_pessoa' });
    const e = await efeitosTitular(app.db);
    expect(e.pessoasOcultas.has('ef-p1')).toBe(true);
    expect(e.cargosOcultos.has('ef-c1')).toBe(true);
    expect(e.movesOcultos.has('ef-m1')).toBe(true);
    expect(e.correcoes.get('pessoa:ef-p3')).toEqual({ cargo: 'CEO' });
    expect(e.pessoasOcultas.has('ef-p4')).toBe(false);
  });
});
