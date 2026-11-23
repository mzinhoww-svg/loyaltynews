import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { InMemoryEditorialStore } from '../api/store';
import { sampleArticle } from '../api/store-contract';
import type { Actor, HandlerCtx } from '../api/handlers';
import { SourceRegistry } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import { PILOTO_LEITOR2, PILOTO_MATERIAS, fechamento, listLeituras, listPiloto, mapPiloto, registerLeitura } from '../api/pilot-handlers';
import type { PilotoItem, PilotoLeitura } from '../api/pilot-handlers';

const NOW = new Date('2026-11-26T12:00:00Z');
const dono: Actor = { userId: 'dono', roles: ['admin'], mfa: true };
const chefe: Actor = { userId: 'chefe', roles: ['editor_chefe'], mfa: true };
const qa3: Actor = { userId: 'qa3', roles: ['revisor'], mfa: true };
const editor: Actor = { userId: 'edu', roles: ['editor'], mfa: true };
let store: InMemoryEditorialStore;
const ctx = (a: Actor | null, mfa = true): HandlerCtx => ({ actor: a && { ...a, mfa }, store, sources: new SourceRegistry(SEED_SOURCES), now: () => NOW, newId: () => 'i' });
const body = <T>(r: { body: unknown }) => r.body as T;

beforeEach(async () => {
  store = new InMemoryEditorialStore();
  for (const m of PILOTO_MATERIAS) await store.putArticle(sampleArticle(`art-${m}`, { status: 'aprovado' }));
});
const mapAll = () => mapPiloto(ctx(dono), Object.fromEntries(PILOTO_MATERIAS.map((m) => [m, `art-${m}`])));
const achado = (g: 'alta' | 'media' | 'baixa', over = {}) => ({ trecho: 'a taxa é de 3%', tipo: 'numero' as const, gravidade: g, ...over });
const ok3 = { fatosNasEvidencias: true, tom: true, nadaInventado: true };
const leitura = (leitor: 1 | 2, achados: unknown[] = [], over: Record<string, unknown> = {}) => ({ leitor, achados, checklist: ok3, veredito: 'aprovado', ...over });

test('mapa: só admin/editor-chefe; artigo precisa existir; um artigo por matéria; imutável; GET lista null até gerar', async () => {
  const vazio = body<{ items: PilotoItem[] }>(await listPiloto(ctx(qa3), {}));
  assert.equal(vazio.items.length, 10); assert.ok(vazio.items.every((i) => i.articleId === null && i.estado === 'nao_gerada'));
  assert.deepEqual(vazio.items.filter((i) => i.leitor2).map((i) => i.materia), ['a1', 'a4', 'a6', 'a9']);
  assert.equal((await mapPiloto(ctx(qa3), { a1: 'art-a1' })).status, 403);
  assert.equal((await mapPiloto(ctx(editor), { a1: 'art-a1' })).status, 403);
  assert.equal((await mapPiloto(ctx(dono), { a1: 'nao-existe' })).status, 404);
  assert.equal((await mapPiloto(ctx(dono), { a11: 'art-a1' })).status, 400);
  assert.equal((await mapPiloto(ctx(dono), { a1: 'art-a1', a2: 'art-a1' })).status, 409, 'o mesmo artigo em duas matérias');
  assert.equal((await mapPiloto(ctx(dono), { a1: 'art-a1' })).status, 201);
  assert.equal((await mapPiloto(ctx(dono), { a1: 'art-a2' })).status, 409, 'a1 já mapeada (imutável)');
  assert.equal((await mapPiloto(ctx(dono), { a2: 'art-a1' })).status, 409, 'artigo já usado');
  const l = body<{ items: PilotoItem[] }>(await listPiloto(ctx(qa3), {}));
  assert.equal(l.items[0]!.articleId, 'art-a1'); assert.equal(l.items[0]!.estado, 'aguardando_leitura'); assert.equal(l.items[1]!.articleId, null);
  assert.ok(l.items[0]!.fonte, 'fonte vem da 1ª evidência'); assert.equal((await listPiloto(ctx(null), {})).status, 401);
  assert.equal((await listPiloto(ctx(dono, false), {})).status, 401, 'MFA');
});

test('leitura: papéis (leitor 1 = admin/chefe; leitor 2 = revisor), leitor 2 só em a1/a4/a6/a9, sem matéria gerada 404, uma por leitor, mesma pessoa não lê duas vezes', async () => {
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a1', ...leitura(1) })).status, 404, 'não gerada');
  await mapAll();
  assert.equal((await registerLeitura(ctx(editor), { materia: 'a1', ...leitura(1) })).status, 403);
  assert.equal((await registerLeitura(ctx(qa3), { materia: 'a1', ...leitura(1) })).status, 403, 'revisor não é o leitor 1');
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a1', ...leitura(2) })).status, 403, 'dono não é o leitor 2');
  assert.equal((await registerLeitura(ctx(qa3), { materia: 'a2', ...leitura(2) })).status, 400, 'a2 não tem leitor 2');
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a11', ...leitura(1) })).status, 400);
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a1', ...leitura(1), extra: 1 })).status, 400, 'campo extra');
  const r = await registerLeitura(ctx(dono), { materia: 'a1', ...leitura(1, [achado('baixa')]) });
  assert.equal(r.status, 201); assert.deepEqual(body<Record<string, number>>(r), { materia: 'a1', leitor: 1, unsupportedFacts: 1, altas: 0, medias: 0, baixas: 1 });
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a1', ...leitura(1) })).status, 409, 'uma leitura por leitor e matéria');
  assert.equal((await registerLeitura(ctx(chefe), { materia: 'a1', ...leitura(1) })).status, 409, 'outro dono também não sobrescreve');
  const segunda = await registerLeitura(ctx(qa3), { materia: 'a1', ...leitura(2) });
  assert.equal(segunda.status, 201);
});

test('validação: aprovado é incompatível com achado alto ou checklist incompleto; evidenciaId precisa ser do artigo; gravidade e tipo fechados', async () => {
  await mapAll();
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a2', ...leitura(1, [achado('alta')]) })).status, 400);
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a2', ...leitura(1, [], { checklist: { ...ok3, tom: false } }) })).status, 400);
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a2', ...leitura(1, [achado('baixa', { evidenciaId: 'ev_de_outro' })]) })).status, 400);
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a2', ...leitura(1, [achado('baixa', { tipo: 'opiniao' })]) })).status, 400);
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a2', ...leitura(1, [achado('grave' as never)]) })).status, 400);
  assert.equal((await registerLeitura(ctx(dono), { materia: 'a2', ...leitura(1, [{ ...achado('media'), trecho: 'x' }]) })).status, 400, 'trecho muito curto');
  const bloq = await registerLeitura(ctx(dono), { materia: 'a2', ...leitura(1, [achado('alta', { evidenciaId: 'ev_1' })], { veredito: 'bloqueado', checklist: { ...ok3, fatosNasEvidencias: false } }) });
  assert.equal(bloq.status, 201); assert.equal(body<{ altas: number }>(bloq).altas, 1);
});

test('CEGUEIRA: o leitor 2 não vê a leitura do leitor 1 antes de registrar a dele; o adjudicador só vê as duas quando ambas existem; trilha de auditoria', async () => {
  await mapAll();
  await registerLeitura(ctx(dono), { materia: 'a4', ...leitura(1, [achado('media')]) });
  const antes = body<{ leituras: PilotoLeitura[]; ocultas: number }>(await listLeituras(ctx(qa3), { materia: 'a4' }));
  assert.equal(antes.leituras.length, 0); assert.equal(antes.ocultas, 1, 'sabe que existe, não vê o conteúdo');
  const lista = body<{ items: PilotoItem[]; fechamento?: unknown }>(await listPiloto(ctx(qa3), {}));
  assert.equal(lista.fechamento, undefined, 'o fechamento (contagens) não vai ao leitor 2');
  assert.deepEqual(lista.items.find((i) => i.materia === 'a4')!.leituras, { leitor1: true, leitor2: false });
  // adjudicador que não leu: ainda não vê (falta a leitura do leitor 2)
  assert.equal(body<{ leituras: unknown[] }>(await listLeituras(ctx(chefe), { materia: 'a4' })).leituras.length, 0);
  assert.equal((await registerLeitura(ctx(qa3), { materia: 'a4', ...leitura(2) })).status, 201);
  const depois = body<{ leituras: PilotoLeitura[] }>(await listLeituras(ctx(qa3), { materia: 'a4' }));
  assert.deepEqual(depois.leituras.map((l) => l.leitor).sort(), [1, 2], 'depois de registrar a dele, vê as duas');
  assert.equal(body<{ leituras: unknown[] }>(await listLeituras(ctx(chefe), { materia: 'a4' })).leituras.length, 2, 'adjudicador vê as duas com ambas registradas');
  assert.equal(body<{ leituras: unknown[] }>(await listLeituras(ctx(editor), { materia: 'a4' })).leituras.length, 0, 'editor nunca vê');
  const acts = (await store.listAudit()).filter((a) => a.action.startsWith('piloto.')).map((a) => a.action);
  assert.equal(acts.filter((a) => a === 'piloto.leitura').length, 2); assert.equal(acts.filter((a) => a === 'piloto.mapped').length, 10);
});

test('fechamento (critério do PM): 0 altas e ≤ 1 média nas 10 matérias do leitor 1; divergências entre leitores só nas matérias com dois leitores', async () => {
  await mapAll();
  assert.equal(body<{ fechamento: { criterio: string } }>(await listPiloto(ctx(dono), {})).fechamento.criterio, 'em_andamento');
  for (const m of PILOTO_MATERIAS) await registerLeitura(ctx(dono), { materia: m, ...leitura(1, m === 'a3' ? [achado('media')] : [achado('baixa')]) });
  const f1 = body<{ fechamento: ReturnType<typeof fechamento> }>(await listPiloto(ctx(dono), {})).fechamento;
  assert.deepEqual([f1.lidas, f1.altas, f1.medias, f1.baixas, f1.criterio], [10, 0, 1, 9, 'aprovado']);
  await registerLeitura(ctx(qa3), { materia: 'a1', ...leitura(2, [achado('baixa')]) }); // concorda
  await registerLeitura(ctx(qa3), { materia: 'a4', ...leitura(2, [achado('media')], { veredito: 'aprovado' }) }); // diverge (média a mais)
  const f2 = body<{ fechamento: ReturnType<typeof fechamento> }>(await listPiloto(ctx(dono), {})).fechamento;
  assert.deepEqual(f2.divergencias, ['a4']);
  assert.equal(PILOTO_LEITOR2.size, 4);
  // 2 médias reprovam; 1 alta reprova mesmo com bloqueado
  const l = (m: string, altas: number, medias: number): PilotoLeitura => ({ materia: m, articleId: 'x', leitor: 1, por: 'p', em: '', achados: [], checklist: ok3, veredito: 'bloqueado', unsupportedFacts: altas + medias, altas, medias, baixas: 0 });
  assert.equal(fechamento(PILOTO_MATERIAS.map((m, i) => l(m, 0, i < 2 ? 1 : 0))).criterio, 'reprovado');
  assert.equal(fechamento([l('a1', 1, 0)]).criterio, 'reprovado');
  assert.equal(fechamento([l('a1', 0, 0)]).criterio, 'em_andamento');
});
