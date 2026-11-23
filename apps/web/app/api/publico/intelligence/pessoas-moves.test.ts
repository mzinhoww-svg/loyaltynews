/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEvidence, addRole, ingestBatch, INGEST_SCHEMA_VERSION, resolveOrCreatePerson, reviewMove, SECONDARY_BASIS, upsertOrganization } from '@ln/intelligence';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../../_lib/testkit';
import { dispatchIntelligence as d, intelDb } from '../../_lib/intelligence';
import * as pessoas from './pessoas/route';
import * as pessoa from './pessoas/[id]/route';
import * as moves from './moves/route';
import * as move from './moves/[id]/route';

// Pessoas, cargos e Moves no portal (contrato v1 do Frontend 2) e a fila "a confirmar" no Studio (cargo de fonte secundária: inferido, nunca fato nem Move).
let app: Awaited<ReturnType<typeof makeApp>>;
let chefe: Actor;
let editor: Actor;
let revisor: Actor;
let ids: Record<string, string>;
const T = '2026-11-01T00:00:00Z';
const ON = { personIngestion: true, extendedPersonalData: false } as any;
const STU = (p: string) => `/api/studio/intelligence${p}`;
const lista = (q: Record<string, string> = {}) => call(pessoas.GET, 'GET', { path: '/api/publico/intelligence/pessoas', query: q });
const umaPessoa = (id: string) => call(pessoa.GET, 'GET', { path: `/api/publico/intelligence/pessoas/${id}`, params: { id } });
const listaMoves = (q: Record<string, string> = {}) => call(moves.GET, 'GET', { path: '/api/publico/intelligence/moves', query: q });
const umMove = (id: string) => call(move.GET, 'GET', { path: `/api/publico/intelligence/moves/${id}`, params: { id } });
const flag = async <T,>(on: boolean, fn: () => Promise<T>): Promise<T> => {
  app.deps.flags.intelligencePessoas = on;
  try {
    return await fn();
  } finally {
    app.deps.flags.intelligencePessoas = false;
  }
};

beforeAll(async () => {
  app = await makeApp();
  [chefe, editor, revisor] = [await app.actor('editor_chefe'), await app.actor('editor'), await app.actor('revisor')];
  const db = intelDb(app.db);
  const ev = (nome: string, url: string, mock = true) => addEvidence(db, { sourceUrl: url, sourceName: nome, retrievedAt: T, isMock: mock, excerpt: 'trecho que nunca sai', contentHash: 'h'.repeat(64) } as any);
  const alfa = await upsertOrganization(db, { legalName: 'Alfa Programa S.A.', tradeName: 'Alfa', evidenceId: await ev('Alfa RI', 'https://ri.alfa.example.invalid/quem-somos'), observedAt: T });
  const beta = await upsertOrganization(db, { legalName: 'Beta Banco S.A.', evidenceId: await ev('Beta RI', 'https://beta.example.invalid/governanca'), observedAt: T });
  const pessoa = async (nome: string, org: string, e: string) => (await resolveOrCreatePerson(db, { fullName: nome, organizationId: org, evidenceId: await ev(`Pessoa ${nome}`, e), observedAt: T }, ON)).id;
  const ana = await pessoa('MOCK Ana Alfa', alfa, 'https://ri.alfa.example.invalid/ana');
  const bia = await pessoa('MOCK Bia Beta', beta, 'https://beta.example.invalid/bia');
  const caio = await pessoa('MOCK Caio Secundario', alfa, 'https://www.linkedin.com/in/caio-mock');
  const dora = await pessoa('MOCK Dora Antiga', beta, 'https://beta.example.invalid/dora');
  const role = async (p: string, o: string, titulo: string, validFrom: string, extra: Record<string, unknown> = {}) => {
    const { evUrl, ...resto } = extra as { evUrl?: string };
    return addRole(db, { personId: p, organizationId: o, title: titulo, validFrom, evidenceId: await ev(`Cargo ${titulo}`, evUrl ?? `https://${o === alfa ? 'ri.alfa' : 'beta'}.example.invalid/${titulo.toLowerCase()}`), observedAt: T, ...resto } as any);
  };
  const anaCeo = await role(ana, alfa, 'CEO', '2024-01-01');
  await role(bia, beta, 'Diretora', '2023-01-01');
  const caioRole = await role(caio, alfa, 'Gerente', '2025-01-01', { certainty: 'inferred', inferenceBasis: SECONDARY_BASIS, evUrl: 'https://www.linkedin.com/in/caio-mock' });
  await role(dora, beta, 'Diretora Antiga', '2018-01-01', { validTo: '2020-01-01' });
  const caioDescartar = await role(caio, beta, 'Consultor', '2025-02-01', { certainty: 'inferred', inferenceBasis: SECONDARY_BASIS });
  ids = { alfa, beta, ana, bia, caio, dora, anaCeo, caioRole, caioDescartar };
  // dois Moves: um CONFIRMADO (Ana: Gerente → CEO na Alfa, pela ingestão) e um que fica só detectado
  const mk = (title: string, at: string, nome = 'MOCK Eva Ingerida') => ({
    schemaVersion: INGEST_SCHEMA_VERSION,
    evidence: { sourceUrl: `https://ri.alfa.example.invalid/eva-${at}`, sourceName: 'MOCK Alfa RI', retrievedAt: at, isMock: true },
    observations: [{ personName: nome, orgName: 'Alfa Programa S.A.', title, kind: 'present' as const, observedAt: at }],
  });
  await ingestBatch(db, mk('Gerente', '2026-10-01T00:00:00Z'), ON);
  await ingestBatch(db, mk('Diretora', '2026-11-10T00:00:00Z'), ON);
  await ingestBatch(db, mk('Analista', '2026-10-05T00:00:00Z', 'MOCK Fábio Detectado'), ON);
  await ingestBatch(db, mk('Coordenador', '2026-11-12T00:00:00Z', 'MOCK Fábio Detectado'), ON);
  const todos = await db.query<{ id: string; person_name: string }>(`SELECT m.id, p.full_name AS person_name FROM intelligence.move m JOIN intelligence.person p ON p.id = m.person_id`);
  const eva = todos.rows.find((m) => m.person_name === 'MOCK Eva Ingerida')!;
  await reviewMove(db, eva.id, 'confirmed');
  ids.moveConfirmado = eva.id;
  ids.moveDetectado = todos.rows.find((m) => m.person_name === 'MOCK Fábio Detectado')!.id;
}, 180_000);
afterAll(async () => {
  app.deps.flags.intelligencePessoas = false;
  await app.close();
});

describe('portal: flag intelligencePessoas desligada (estado atual)', () => {
  it('listas respondem 200 honesto (data [], total 0, disponivel false); detalhes 404; id inválido 400', async () => {
    for (const r of [await lista(), await listaMoves()]) expect([r.status, r.body]).toEqual([200, { data: [], total: 0, disponivel: false }]);
    expect((await umaPessoa(ids.ana!)).status).toBe(404);
    expect((await umMove(ids.moveConfirmado!)).status).toBe(404);
    expect((await umaPessoa('nao-uuid')).body.error.code).toBe('invalid_input');
    expect((await lista({ limit: '0' })).status).toBe(400); // validação vale com a flag desligada também
  });
});

describe('portal: pessoas (flag ligada)', () => {
  it('só pessoa com cargo DECLARADO; só cargos vigentes na lista; ordem por nome; cargo traz empresa, fonte, datas e mock; nada interno', async () => {
    const r = await flag(true, () => lista());
    expect(r.body).toMatchObject({ disponivel: true });
    const nomes = r.body.data.map((p: any) => p.nome);
    expect(nomes).toEqual(['MOCK Ana Alfa', 'MOCK Bia Beta', 'MOCK Dora Antiga', 'MOCK Eva Ingerida', 'MOCK Fábio Detectado'].sort((a, b) => a.localeCompare(b)).filter((n) => nomes.includes(n)));
    expect(nomes).not.toContain('MOCK Caio Secundario'); // só cargo inferido (a confirmar): nunca sai
    const ana = r.body.data.find((p: any) => p.nome === 'MOCK Ana Alfa');
    expect(ana.cargos).toEqual([{
      id: ids.anaCeo, titulo: 'CEO', empresa: { id: ids.alfa, nome: 'Alfa' }, vigenteDesde: '2024-01-01', vigenteAte: null, validadoEm: '2026-11-01T00:00:00.000Z',
      fonte: { nome: 'Cargo CEO', url: 'https://ri.alfa.example.invalid/ceo', coletadoEm: '2026-11-01T00:00:00.000Z' }, mock: true,
    }]);
    expect(r.body.data.find((p: any) => p.nome === 'MOCK Dora Antiga').cargos).toEqual([]); // cargo encerrado não é "atual"
    expect(JSON.stringify(r.body)).not.toMatch(/trecho que nunca sai|excerpt|content_hash|contentHash|hhhh|linkedin|inferred/);
  });

  it('filtros: q (nome), empresa (cargo vigente nela), limit/offset; total reflete o filtro', async () => {
    await flag(true, async () => {
      expect((await lista({ q: 'bia' })).body.data.map((p: any) => p.nome)).toEqual(['MOCK Bia Beta']);
      expect((await lista({ empresa: ids.beta! })).body.data.map((p: any) => p.nome)).toEqual(['MOCK Bia Beta']);
      expect((await lista({ q: '%' })).body.total).toBe(0);
      const p1 = await lista({ limit: '2' });
      const p2 = await lista({ limit: '2', offset: '2' });
      expect([p1.body.data.length, p2.body.data.length]).toEqual([2, 2]);
      expect(p1.body.total).toBe(p2.body.total);
      expect((await lista({ empresa: 'nao-uuid' })).status).toBe(400);
    });
  });

  it('detalhe: cargos atuais, histórico e moves confirmados; só inferido, suprimido e inexistente = 404', async () => {
    await flag(true, async () => {
      const dora = (await lista({ q: 'dora' })).body.data[0];
      const d1 = await umaPessoa(dora.id);
      expect(d1.body.data).toMatchObject({ nome: 'MOCK Dora Antiga', cargosAtuais: [], mock: true });
      expect(d1.body.data.historico.map((c: any) => [c.titulo, c.vigenteAte])).toEqual([['Diretora Antiga', '2020-01-01']]);
      expect(d1.body.data.fonte).toMatchObject({ nome: 'Pessoa MOCK Dora Antiga' });
      const ana = await umaPessoa(ids.ana!);
      expect(ana.body).toMatchObject({ disponivel: true, data: { nome: 'MOCK Ana Alfa', perfilPublico: null } });
      expect(ana.body.data.cargosAtuais.map((c: any) => c.titulo)).toEqual(['CEO']);
      expect((await umaPessoa(ids.caio!)).status).toBe(404); // só cargos inferidos
      expect((await umaPessoa('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      await intelDb(app.db).query(`UPDATE intelligence.person SET suppressed_at = now() WHERE id = $1`, [ids.bia]);
      expect((await umaPessoa(ids.bia!)).status).toBe(404);
      expect((await lista()).body.data.map((p: any) => p.nome)).not.toContain('MOCK Bia Beta');
      await intelDb(app.db).query(`UPDATE intelligence.person SET suppressed_at = NULL WHERE id = $1`, [ids.bia]);
    });
  });
});

describe('portal: Moves (flag ligada)', () => {
  it('só Move CONFIRMADO, com antes e depois (cargo, empresa, fonte e datas), tipo, base e mock; o detectado não sai nem por id', async () => {
    await flag(true, async () => {
      const r = await listaMoves();
      expect(r.body).toMatchObject({ disponivel: true, total: 1 });
      const m = r.body.data[0];
      expect(m).toMatchObject({ id: ids.moveConfirmado, tipo: 'title_change', pessoa: { nome: 'MOCK Eva Ingerida' }, mock: true });
      expect(m.antes).toMatchObject({ titulo: 'Gerente', empresa: { id: ids.alfa, nome: 'Alfa' } });
      expect(m.depois).toMatchObject({ titulo: 'Diretora', empresa: { id: ids.alfa, nome: 'Alfa' } });
      expect(m.antes.fonte.url).toMatch(/^https:\/\/ri\.alfa/);
      expect(Object.keys(m.depois).sort()).toEqual(['empresa', 'fonte', 'titulo', 'validadoEm', 'vigenteAte', 'vigenteDesde']);
      expect(JSON.stringify(r.body)).not.toMatch(/excerpt|content_hash|contentHash|quote/);
      expect((await umMove(ids.moveConfirmado!)).body.data.id).toBe(ids.moveConfirmado);
      expect((await umMove(ids.moveDetectado!)).status).toBe(404);
      expect((await umMove('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await listaMoves({ pessoa: ids.ana! })).body.total).toBe(0);
      expect((await listaMoves({ empresa: ids.alfa! })).body.total).toBe(1);
      expect((await listaMoves({ empresa: ids.beta! })).body.total).toBe(0);
    });
  });

  it('o detalhe da pessoa traz os moves confirmados dela', async () => {
    await flag(true, async () => {
      const eva = (await lista({ q: 'eva' })).body.data[0];
      expect((await umaPessoa(eva.id)).body.data.moves.map((x: any) => x.id)).toEqual([ids.moveConfirmado]);
    });
  });
});

describe('Studio: fila "a confirmar" (cargos de fonte secundária)', () => {
  const roles = (q: Record<string, string> = {}, as: Actor | null = chefe) => call(d, 'GET', { path: STU('/roles'), query: q, as });
  const confirmar = (id: string, officialUrl: unknown, as: Actor | null = editor) => call(d, 'POST', { path: STU(`/roles/${id}/confirm`), body: { officialUrl }, as });
  const descartar = (id: string, motivo: unknown, as: Actor | null = editor) => call(d, 'POST', { path: STU(`/roles/${id}/discard`), body: { motivo }, as });

  it('lista com nível da fonte (official/secondary), empresa, evidência e total; filtros por certeza, empresa e texto; sem sessão 401', async () => {
    expect((await roles({}, null)).status).toBe(401);
    const todas = await roles();
    expect(todas.status).toBe(200);
    expect(todas.body.total).toBe(todas.body.items.length);
    const caio = todas.body.items.find((r: any) => r.role_id === ids.caioRole);
    expect(caio).toMatchObject({ person_name: 'MOCK Caio Secundario', title: 'Gerente', certainty: 'inferred', source_level: 'secondary', status: 'to_confirm', evidence: { is_mock: true } });
    expect(caio.evidence.source_url).toContain('linkedin.com');
    expect(todas.body.items.find((r: any) => r.role_id === ids.anaCeo)).toMatchObject({ certainty: 'declared', source_level: 'official' });
    expect((await roles({ certainty: 'inferred' })).body.items.every((r: any) => r.source_level === 'secondary')).toBe(true);
    expect((await roles({ certainty: 'declared' })).body.items.some((r: any) => r.certainty === 'inferred')).toBe(false);
    expect((await roles({ organizationId: ids.beta!, certainty: 'inferred' })).body.items.map((r: any) => r.role_id)).toEqual([ids.caioDescartar]);
    // filtro por nível da fonte: oficial = declarado; secundária = "a confirmar"; total e paginação refletem o filtro
    const sec = await roles({ source_level: 'secondary' });
    expect(sec.body.items.map((r: any) => r.role_id).sort()).toEqual([ids.caioRole, ids.caioDescartar].sort());
    expect(sec.body.total).toBe(2);
    expect((await roles({ source_level: 'official' })).body.items.every((r: any) => r.certainty === 'declared')).toBe(true);
    expect((await roles({ source_level: 'inferred' })).body.total).toBe(0);
    expect((await roles({ source_level: 'secondary', limit: '1', offset: '1' })).body).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect((await roles({ source_level: 'xpto' })).status).toBe(400);
    expect((await roles({ q: 'caio' })).body.items.length).toBeGreaterThan(0);
    expect((await roles({ certainty: 'talvez' })).status).toBe(400);
    expect((await roles({ organizationId: 'x' })).status).toBe(400);
    expect((await roles({ limit: '1' })).body.items).toHaveLength(1);
    expect(JSON.stringify(todas.body)).not.toMatch(/excerpt|content_hash|trecho que nunca sai/);
  });

  it('confirmar: revisor 403; link do LinkedIn/The Org, http, site de OUTRA empresa e URL inválida são recusados; nada muda', async () => {
    const id = ids.caioRole!;
    expect((await confirmar(id, 'https://ri.alfa.example.invalid/caio', revisor)).status).toBe(403);
    const ruins: Array<[unknown, number, string]> = [
      ['https://www.linkedin.com/in/caio-mock', 400, 'invalid_input'],
      ['https://br.theorg.com/org/alfa', 400, 'invalid_input'],
      ['http://ri.alfa.example.invalid/caio', 400, 'invalid_input'],
      ['https://beta.example.invalid/governanca', 422, 'NOT_OFFICIAL_SOURCE'], // oficial, mas de OUTRA empresa
      ['https://alfa.example.invalid.evil.example/x', 422, 'NOT_OFFICIAL_SOURCE'],
      ['https://user:senha@ri.alfa.example.invalid/x', 400, 'invalid_input'],
      ['não é url', 400, 'invalid_input'],
      [undefined, 400, 'invalid_input'],
    ];
    for (const [url, status, code] of ruins) {
      const r = await confirmar(id, url);
      expect([r.status, r.body.error.code], String(url)).toEqual([status, code]);
    }
    expect((await confirmar('00000000-0000-4000-8000-000000000000', 'https://ri.alfa.example.invalid/x')).status).toBe(404);
    expect((await confirmar('nao-uuid', 'https://ri.alfa.example.invalid/x')).status).toBe(400);
    expect((await confirmar(ids.anaCeo!, 'https://ri.alfa.example.invalid/x')).body.error.code).toBe('not_inferred'); // já é declarado
    expect((await roles({ certainty: 'inferred' })).body.items.map((r: any) => r.role_id)).toContain(id);
  });

  it('confirmar com a página oficial do MESMO site (subdomínio vale): vira declarado com evidência nova, sai da fila, NÃO gera Move e passa a aparecer no portal; auditado; repetir = 409', async () => {
    const antesMoves = (await intelDb(app.db).query<{ n: string }>(`SELECT count(*)::text AS n FROM intelligence.move`)).rows[0]!.n;
    const r = await confirmar(ids.caioRole!, 'https://noticias.ri.alfa.example.invalid/diretoria/caio');
    expect(r).toMatchObject({ status: 200, body: { id: ids.caioRole, certainty: 'declared', source_level: 'official', confirmed_by: editor.id } });
    const depois = (await roles({ certainty: 'declared', q: 'caio' })).body.items.find((x: any) => x.role_id === ids.caioRole);
    expect(depois).toMatchObject({ certainty: 'declared', source_level: 'official', evidence: { source_url: 'https://noticias.ri.alfa.example.invalid/diretoria/caio', is_mock: false } });
    expect(depois.source_level).toBe('official');
    expect((await roles({ certainty: 'inferred' })).body.items.map((x: any) => x.role_id)).not.toContain(ids.caioRole);
    expect((await intelDb(app.db).query<{ n: string }>(`SELECT count(*)::text AS n FROM intelligence.move`)).rows[0]!.n).toBe(antesMoves); // confirmar não cria Move
    await flag(true, async () => expect((await lista({ q: 'caio' })).body.data.map((p: any) => p.nome)).toEqual(['MOCK Caio Secundario']));
    expect((await confirmar(ids.caioRole!, 'https://ri.alfa.example.invalid/outra')).body.error.code).toBe('not_inferred');
    const log = (await app.db.select().from(schema.auditLog)).filter((l) => l.action === 'intelligence.cargo_confirmado');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: editor.id, resourceId: ids.caioRole });
    expect(log[0]!.detalhe).toEqual({ pessoa: 'MOCK Caio Secundario', cargo: 'Gerente', fonteOficial: 'noticias.ri.alfa.example.invalid' });
  });

  it('descartar: motivo obrigatório (5 a 300), revisor 403; fecha o cargo (não apaga), registra o motivo, sai da fila, nunca vira fato, auditado; repetir 409', async () => {
    const id = ids.caioDescartar!;
    expect((await descartar(id, 'x')).status).toBe(400);
    expect((await descartar(id, 'x'.repeat(201))).status).toBe(400);
    expect((await descartar(id, 'cargo antigo', revisor)).status).toBe(403);
    expect((await descartar('00000000-0000-4000-8000-000000000000', 'não existe esse cargo')).status).toBe(404);
    const r = await descartar(id, 'Perfil desatualizado: a pessoa não está mais na empresa');
    expect(r).toMatchObject({ status: 200, body: { id, discarded: true, discarded_by: editor.id } });
    expect((await roles({ certainty: 'inferred' })).body.items.map((x: any) => x.role_id)).not.toContain(id);
    const row = (await intelDb(app.db).query<{ valid_to: string; valid_from: string; inference_basis: string; certainty: string }>(`SELECT valid_from::text, valid_to::text, inference_basis, certainty FROM intelligence.role_assignment WHERE id = '${id}'`)).rows[0]!;
    expect(row.certainty).toBe('inferred'); // continua inferido: nunca virou fato
    expect(row.valid_to).toBe(row.valid_from);
    expect(row.inference_basis).toMatch(/^descartado: Perfil desatualizado: a pessoa não está mais na empresa \| a confirmar/);
    // depois de descartado o cargo está FECHADO e continua inferido: a fila não o lista e a confirmação oficial (que exige outra fonte) não o reabre pela lista
    expect((await roles({ organizationId: ids.beta!, certainty: 'inferred' })).body.items).toEqual([]);
    const log = (await app.db.select().from(schema.auditLog)).filter((l) => l.action === 'intelligence.cargo_descartado');
    expect(log).toHaveLength(1);
    expect(log[0]!.detalhe).toMatchObject({ pessoa: 'MOCK Caio Secundario', cargo: 'Consultor' });
  });
});
