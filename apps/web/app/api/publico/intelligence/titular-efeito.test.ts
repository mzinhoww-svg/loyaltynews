/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEvidence, addRole, ingestBatch, INGEST_SCHEMA_VERSION, resolveOrCreatePerson, reviewMove, upsertOrganization } from '@ln/intelligence';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import { dispatchIntelligence as d, intelDb } from '../../_lib/intelligence';
import * as pessoas from './pessoas/route';
import * as pessoa from './pessoas/[id]/route';
import * as moves from './moves/route';
import * as move from './moves/[id]/route';
import * as empresa from './empresas/[id]/route';

// DP-38: as decisões da fila do titular (titular_pedidos decididos) valem no portal. remover_pessoa: perfil 404 e fora de listas, empresas e Moves;
// remover_cargo: o cargo some (e o Move que o cita); remover Move: só o Move; corrigir: sobrepõe campos conhecidos. Negado, em análise e sem alvo: nada muda.
let app: Awaited<ReturnType<typeof makeApp>>;
let chefe: Actor;
let ids: Record<string, string>;
let seq = 0;
const T = '2026-11-01T00:00:00Z';
const ON = { personIngestion: true, extendedPersonalData: false } as any;
const lista = (q: Record<string, string> = {}) => call(pessoas.GET, 'GET', { path: '/api/publico/intelligence/pessoas', query: q });
const umaPessoa = (id: string) => call(pessoa.GET, 'GET', { path: `/api/publico/intelligence/pessoas/${id}`, params: { id } });
const listaMoves = (q: Record<string, string> = {}) => call(moves.GET, 'GET', { path: '/api/publico/intelligence/moves', query: q });
const umMove = (id: string) => call(move.GET, 'GET', { path: `/api/publico/intelligence/moves/${id}`, params: { id } });
const umaEmpresa = (id: string) => call(empresa.GET, 'GET', { path: `/api/publico/intelligence/empresas/${id}`, params: { id } });
const legado = (path: string, query: Record<string, unknown> = {}, as: Actor | null = null) => call(d, 'GET', { path: `/api/intelligence${path}`, query: query as any, as });
const studio = (path: string) => call(d, 'GET', { path: `/api/studio/intelligence${path}`, as: chefe });
const nomes = (r: any) => r.body.data.map((p: any) => p.nome);

/** Um pedido já decidido (ou não) sobre um alvo: o que a fila do Backend 2 grava. */
async function pedido(estado: 'corrigido' | 'removido' | 'negado' | 'em_analise', alvoTipo: string | null, alvoId: string | null, decisao: Record<string, unknown> | null): Promise<void> {
  const now = new Date('2026-11-20T12:00:00Z');
  const n = ++seq;
  const decidido = estado === 'em_analise' ? null : now;
  await app.db.insert(schema.titularPedidos).values({
    id: `ped-${n}`, tipo: estado === 'corrigido' ? 'correcao' : 'remocao', estado, nome: 'Titular Teste', contato: `t${n}@example.org`, url: `https://ln.example/intelligence/pessoas/${alvoId ?? 'x'}`,
    texto: `pedido ${n}`, alvoTipo, alvoId, prazoEm: new Date('2026-12-05T00:00:00Z'), decisao: decisao as any, decididoPor: decidido ? chefe.id : null, decididoEm: decidido,
    chaveDedupe: `chave-${n}`, recebidoEm: now, atualizadoEm: now,
  } as any);
}
async function limpar(): Promise<void> {
  await app.db.delete(schema.titularPedidos);
}
const comFlag = async <T,>(fn: () => Promise<T>): Promise<T> => {
  app.deps.flags.intelligencePessoas = true;
  try {
    return await fn();
  } finally {
    app.deps.flags.intelligencePessoas = false;
  }
};

beforeAll(async () => {
  app = await makeApp();
  chefe = await app.actor('editor_chefe');
  const db = intelDb(app.db);
  const ev = (nome: string, url: string) => addEvidence(db, { sourceUrl: url, sourceName: nome, retrievedAt: T, isMock: true });
  const alfa = await upsertOrganization(db, { legalName: 'Alfa Programa S.A.', tradeName: 'Alfa', evidenceId: await ev('Alfa RI', 'https://ri.alfa.example.invalid/quem-somos'), observedAt: T });
  const beta = await upsertOrganization(db, { legalName: 'Beta Banco S.A.', evidenceId: await ev('Beta RI', 'https://beta.example.invalid/governanca'), observedAt: T });
  const pessoaDe = async (nome: string, org: string, url: string) => (await resolveOrCreatePerson(db, { fullName: nome, organizationId: org, evidenceId: await ev(nome, url), observedAt: T }, ON)).id;
  const ana = await pessoaDe('MOCK Ana Alfa', alfa, 'https://ri.alfa.example.invalid/ana');
  const bia = await pessoaDe('MOCK Bia Beta', beta, 'https://beta.example.invalid/bia');
  const caio = await pessoaDe('MOCK Caio Duplo', alfa, 'https://ri.alfa.example.invalid/caio');
  const cargo = async (p: string, o: string, titulo: string, from: string) =>
    addRole(db, { personId: p, organizationId: o, title: titulo, validFrom: from, evidenceId: await ev(`Cargo ${titulo}`, `https://ri.example.invalid/${titulo.toLowerCase()}-${p.slice(0, 4)}`), observedAt: T } as any);
  const anaCeo = await cargo(ana, alfa, 'CEO', '2024-01-01');
  const biaDir = await cargo(bia, beta, 'Diretora', '2023-01-01');
  const caioGer = await cargo(caio, alfa, 'Gerente', '2025-01-01');
  const caioCons = await cargo(caio, beta, 'Consultor', '2025-02-01');
  ids = { alfa, beta, ana, bia, caio, anaCeo, biaDir, caioGer, caioCons };
  // dois Moves CONFIRMADOS (Eva: Gerente → Diretora; Fábio: Analista → Coordenador), cada um com antes e depois declarados
  const mk = (nome: string, title: string, at: string) => ({
    schemaVersion: INGEST_SCHEMA_VERSION,
    evidence: { sourceUrl: `https://ri.alfa.example.invalid/${nome.replace(/\s/g, '-')}-${at}`, sourceName: 'MOCK Alfa RI', retrievedAt: at, isMock: true },
    observations: [{ personName: nome, orgName: 'Alfa Programa S.A.', title, kind: 'present' as const, observedAt: at }],
  });
  for (const [nome, antes, depois] of [['MOCK Eva Movida', 'Gerente', 'Diretora'], ['MOCK Fábio Movido', 'Analista', 'Coordenador']] as const) {
    await ingestBatch(db, mk(nome, antes, '2026-10-01T00:00:00Z'), ON);
    await ingestBatch(db, mk(nome, depois, '2026-11-10T00:00:00Z'), ON);
  }
  const todos = await db.query<{ id: string; person_id: string; person_name: string; to_role_id: string; from_role_id: string }>(
    `SELECT m.id, m.person_id, p.full_name AS person_name, m.to_role_id, m.from_role_id FROM intelligence.move m JOIN intelligence.person p ON p.id = m.person_id`,
  );
  for (const m of todos.rows) await reviewMove(db, m.id, 'confirmed');
  const eva = todos.rows.find((m) => m.person_name === 'MOCK Eva Movida')!;
  const fabio = todos.rows.find((m) => m.person_name === 'MOCK Fábio Movido')!;
  Object.assign(ids, { eva: eva.person_id, moveEva: eva.id, evaDepois: eva.to_role_id, fabio: fabio.person_id, moveFabio: fabio.id });
}, 180_000);
afterAll(async () => {
  app.deps.flags.intelligencePessoas = false;
  await app.close();
});

describe('sem pedido decidido: nada muda (linha de base)', () => {
  it('pessoas, Moves, empresa e portal legado mostram tudo; pedido em análise, negado e sem alvo também não mudam nada', async () => {
    await limpar();
    await pedido('em_analise', 'pessoa', ids.ana!, { acao: 'remover_pessoa' });
    await pedido('negado', 'pessoa', ids.bia!, { acao: 'negar', motivo: 'sem fundamento' });
    await pedido('removido', null, null, { acao: 'remover_pessoa' }); // sem alvo identificado
    await comFlag(async () => {
      expect(nomes(await lista())).toEqual(expect.arrayContaining(['MOCK Ana Alfa', 'MOCK Bia Beta', 'MOCK Caio Duplo', 'MOCK Eva Movida', 'MOCK Fábio Movido']));
      expect((await umaPessoa(ids.ana!)).status).toBe(200);
      expect((await listaMoves()).body.total).toBe(2);
      expect((await umaEmpresa(ids.alfa!)).body.data.pessoas.itens.map((p: any) => p.nome)).toContain('MOCK Ana Alfa');
      expect((await legado(`/executives/${ids.ana}`)).status).toBe(200);
    });
  });
});

describe('remover_pessoa', () => {
  it('perfil 404, fora da lista, da empresa e dos Moves (público e portal legado); o Studio ainda vê; outros seguem; total coerente', async () => {
    await limpar();
    await pedido('removido', 'pessoa', ids.eva!, { acao: 'remover_pessoa', motivo: 'pedido do titular' });
    await pedido('removido', 'pessoa', ids.ana!, { acao: 'remover_pessoa' });
    await comFlag(async () => {
      expect((await umaPessoa(ids.eva!)).status).toBe(404);
      expect((await umaPessoa(ids.ana!)).status).toBe(404);
      expect((await umaPessoa(ids.bia!)).status).toBe(200);
      const l = await lista();
      expect(nomes(l)).not.toContain('MOCK Eva Movida');
      expect(nomes(l)).not.toContain('MOCK Ana Alfa');
      expect(nomes(l)).toContain('MOCK Bia Beta');
      expect(l.body.total).toBe(l.body.data.length); // total conta SÓ quem aparece
      expect((await lista({ q: 'eva' })).body).toMatchObject({ data: [], total: 0 });
      const m = await listaMoves();
      expect(m.body.data.map((x: any) => x.pessoa.nome)).toEqual(['MOCK Fábio Movido']);
      expect(m.body.total).toBe(1);
      expect((await umMove(ids.moveEva!)).status).toBe(404);
      expect((await listaMoves({ pessoa: ids.eva! })).body).toMatchObject({ data: [], total: 0 });
      const emp = await umaEmpresa(ids.alfa!);
      expect(emp.body.data.pessoas.itens.map((p: any) => p.nome)).not.toContain('MOCK Ana Alfa');
      expect(JSON.stringify(emp.body)).not.toContain('MOCK Eva Movida');
      // portal legado (/api/intelligence/**)
      expect((await legado(`/executives/${ids.ana}`)).status).toBe(404);
      expect((await legado('/executives', { q: 'Ana' })).body.items).toEqual([]);
      expect(JSON.stringify((await legado(`/companies/${ids.alfa}`)).body.people)).not.toContain('MOCK Ana Alfa');
      expect(JSON.stringify((await legado(`/companies/${ids.alfa}/org-chart`)).body)).not.toContain(ids.ana!);
      expect((await legado('/moves')).body.items.map((x: any) => x.person_name)).toEqual(['MOCK Fábio Movido']);
      expect((await legado('/graph/neighbors', { id: ids.ana!, type: 'person' })).status).toBe(404);
      // o Studio continua vendo (revisão editorial e tratamento do pedido precisam do dado)
      expect((await studio(`/executives/${ids.ana}`)).status).toBe(200);
    });
  });
});

describe('remover_cargo', () => {
  it('o cargo some da pessoa, da lista e da empresa; a pessoa e o outro cargo ficam; um Move que cita o cargo removido também some', async () => {
    await limpar();
    await pedido('removido', 'cargo', ids.caioCons!, { acao: 'remover_cargo' });
    await pedido('removido', 'cargo', ids.evaDepois!, { acao: 'remover_cargo' });
    await comFlag(async () => {
      const p = await umaPessoa(ids.caio!);
      expect(p.status).toBe(200);
      expect(p.body.data.cargosAtuais.map((c: any) => c.titulo)).toEqual(['Gerente']);
      const caio = (await lista()).body.data.find((x: any) => x.nome === 'MOCK Caio Duplo');
      expect(caio.cargos.map((c: any) => c.titulo)).toEqual(['Gerente']);
      expect((await umaEmpresa(ids.beta!)).body.data.pessoas.itens.map((x: any) => x.cargo)).not.toContain('Consultor');
      // Move cujo "depois" foi removido: não mostra meia verdade
      expect((await umMove(ids.moveEva!)).status).toBe(404);
      expect((await listaMoves()).body.data.map((x: any) => x.pessoa.nome)).toEqual(['MOCK Fábio Movido']);
      // portal legado
      expect((await legado(`/executives/${ids.caio}`)).body.roles.map((r: any) => r.title)).toEqual(['Gerente']);
      expect((await legado('/moves')).body.items.map((x: any) => x.person_name)).toEqual(['MOCK Fábio Movido']);
      expect(JSON.stringify((await legado(`/companies/${ids.beta}`)).body.people)).not.toContain('Consultor');
    });
  });

  it('todos os cargos declarados removidos: a pessoa deixa de existir no portal (perfil 404, fora da lista), como sem cargo declarado', async () => {
    await limpar();
    await pedido('removido', 'cargo', ids.biaDir!, { acao: 'remover_cargo' });
    await comFlag(async () => {
      expect((await umaPessoa(ids.bia!)).status).toBe(404);
      expect(nomes(await lista())).not.toContain('MOCK Bia Beta');
      expect((await legado(`/executives/${ids.bia}`)).status).toBe(404);
    });
  });
});

describe('remover um Move', () => {
  it('só o Move some (detalhe 404, fora da lista e do total); a pessoa e os cargos continuam', async () => {
    await limpar();
    await pedido('removido', 'move', ids.moveFabio!, { acao: 'remover_cargo' });
    await comFlag(async () => {
      expect((await umMove(ids.moveFabio!)).status).toBe(404);
      const m = await listaMoves();
      expect(m.body.data.map((x: any) => x.id)).toEqual([ids.moveEva]);
      expect(m.body.total).toBe(1);
      expect((await umaPessoa(ids.fabio!)).status).toBe(200);
      expect((await umaPessoa(ids.fabio!)).body.data.moves).toEqual([]);
      expect((await legado('/moves')).body.items.map((x: any) => x.id)).toEqual([ids.moveEva]);
    });
  });
});

describe('corrigir', () => {
  it('pessoa: `nome` sobrepõe em perfil, lista, Moves, empresa e portal legado; cargo: cargo/empresa/periodo; chave desconhecida é ignorada; marca corrigidoPeloTitular', async () => {
    await limpar();
    await pedido('corrigido', 'pessoa', ids.bia!, { acao: 'corrigir', campos: { nome: 'Beatriz Beta', apelido: 'ignorado' } });
    await pedido('corrigido', 'cargo', ids.biaDir!, { acao: 'corrigir', campos: { cargo: 'Diretora Financeira', empresa: 'Beta Banco', periodo: '2023 a hoje', cor: 'azul' } });
    await pedido('corrigido', 'pessoa', ids.eva!, { acao: 'corrigir', campos: { nome: 'Eva Corrigida' } });
    await comFlag(async () => {
      const p = await umaPessoa(ids.bia!);
      expect(p.body.data).toMatchObject({ nome: 'Beatriz Beta', corrigidoPeloTitular: true });
      expect(p.body.data.cargosAtuais[0]).toMatchObject({ titulo: 'Diretora Financeira', empresa: { nome: 'Beta Banco' }, periodo: '2023 a hoje', corrigidoPeloTitular: true });
      expect(JSON.stringify(p.body)).not.toMatch(/apelido|azul|ignorado/);
      const l = (await lista()).body.data;
      expect(l.find((x: any) => x.id === ids.bia)).toMatchObject({ nome: 'Beatriz Beta' });
      expect(l.map((x: any) => x.nome)).not.toContain('MOCK Bia Beta');
      expect(l.find((x: any) => x.id === ids.ana)).not.toHaveProperty('corrigidoPeloTitular'); // quem não foi corrigido não leva a marca
      expect((await listaMoves()).body.data.map((x: any) => x.pessoa.nome)).toContain('Eva Corrigida');
      expect((await umMove(ids.moveEva!)).body.data.pessoa.nome).toBe('Eva Corrigida');
      const emp = (await umaEmpresa(ids.beta!)).body.data.pessoas.itens.find((x: any) => x.id === ids.bia);
      expect(emp).toMatchObject({ nome: 'Beatriz Beta', cargo: 'Diretora Financeira', corrigidoPeloTitular: true });
      // portal legado: o nome corrigido também vale
      expect((await legado('/executives', { q: 'Bia' })).body.items.map((x: any) => x.full_name)).toEqual(['Beatriz Beta']); // a busca ainda casa pelo nome gravado; o que SAI é o corrigido
      expect((await legado(`/executives/${ids.bia}`)).body.person.full_name).toBe('Beatriz Beta');
    });
  });

  it('vale a decisão mais recente do mesmo alvo; correção SEM efeito quando a pessoa foi removida (a remoção vence)', async () => {
    await limpar();
    await pedido('corrigido', 'pessoa', ids.bia!, { acao: 'corrigir', campos: { nome: 'Primeiro Nome' } });
    await new Promise((r) => setTimeout(r, 5));
    await app.db.insert(schema.titularPedidos).values({
      id: 'ped-recente', tipo: 'correcao', estado: 'corrigido', nome: 'T', contato: 'recente@example.org', url: 'https://ln.example/intelligence/pessoas/x', texto: 'pedido recente', alvoTipo: 'pessoa', alvoId: ids.bia!,
      prazoEm: new Date('2026-12-05T00:00:00Z'), decisao: { acao: 'corrigir', campos: { nome: 'Nome Mais Recente' } } as any, decididoPor: chefe.id, decididoEm: new Date('2026-11-22T12:00:00Z'),
      chaveDedupe: 'chave-recente', recebidoEm: new Date('2026-11-21T12:00:00Z'), atualizadoEm: new Date('2026-11-22T12:00:00Z'),
    } as any);
    await comFlag(async () => {
      expect((await umaPessoa(ids.bia!)).body.data.nome).toBe('Nome Mais Recente');
    });
    await pedido('removido', 'pessoa', ids.bia!, { acao: 'remover_pessoa' });
    await comFlag(async () => {
      expect((await umaPessoa(ids.bia!)).status).toBe(404);
    });
  });
});

describe('flag desligada e fila', () => {
  it('com a flag desligada nada de pessoa sai, com ou sem pedido; a fila responde efeitoPublico: aplicado', async () => {
    await limpar();
    await pedido('removido', 'pessoa', ids.ana!, { acao: 'remover_pessoa' });
    expect((await lista()).body).toEqual({ data: [], total: 0, disponivel: false });
    expect((await umaPessoa(ids.bia!)).status).toBe(404);
    const { EFEITO_APLICADO } = await import('../../_lib/titular-efeito');
    expect(EFEITO_APLICADO).toBe(true);
  });
});
