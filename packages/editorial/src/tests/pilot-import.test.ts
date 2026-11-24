import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { InMemoryEditorialStore } from '../api/store';
import { sampleArticle } from '../api/store-contract';
import type { Actor, HandlerCtx } from '../api/handlers';
import { SourceRegistry } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import { PILOTO_MATERIAS, importLeitura2, listPiloto, mapPiloto, registerFolha, registerLeitura, revogarFolha } from '../api/pilot-handlers';
import type { PilotoItem, PilotoLeitura } from '../api/pilot-handlers';

// Importação auditada da leitura do leitor 2 (folha lida fora do Studio) e registro do hash da folha no 1º envio.
const NOW = new Date('2026-11-26T12:00:00Z');
const dono: Actor = { userId: 'dono', roles: ['admin'], mfa: true };
const qa3: Actor = { userId: 'qa3', roles: ['revisor'], mfa: true };
const editor: Actor = { userId: 'edu', roles: ['editor'], mfa: true };
let store: InMemoryEditorialStore;
const ctx = (a: Actor | null): HandlerCtx => ({ actor: a, store, sources: new SourceRegistry(SEED_SOURCES), now: () => NOW, newId: () => 'i' });
const body = <T>(r: { body: unknown }) => r.body as T;
const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const OK3 = { fatosNasEvidencias: true, tom: true, nadaInventado: true };

async function seed(): Promise<void> {
  store = new InMemoryEditorialStore();
  for (const m of PILOTO_MATERIAS) await store.putArticle(sampleArticle(`art-${m}`, { status: 'aprovado' }));
  await mapPiloto(ctx(dono), Object.fromEntries(PILOTO_MATERIAS.map((m) => [m, `art-${m}`])));
}
beforeEach(seed);

const arquivo = (sha = SHA) => ({ nome: 'folha-qa3.csv', sha256: sha, linhas: 6 });
const achado = (g: string, over: Record<string, unknown> = {}) => ({ trecho: 'a taxa é de 3%', tipo: 'numero', gravidade: g, ...over });
const lei = (materia: string, achados: unknown[] = [], over: Record<string, unknown> = {}) => ({ materia, achados, checklist: OK3, veredito: 'aprovado', ...over });
const imp = (leituras: unknown[], over: Record<string, unknown> = {}) => ({ arquivo: arquivo(), leitor2Nome: 'QA 3', leituras, ...over });
const leitor1 = (materia: string, achados: unknown[] = []) => registerLeitura(ctx(dono), { materia, leitor: 1, achados, checklist: OK3, veredito: 'aprovado' });
const gravadas2 = async () => (await store.listAudit()).filter((a) => a.action === 'piloto.leitura' && a.target.endsWith(':2'));

test('só admin/editor-chefe importa; leitor 1 pendente = 409 LEITOR1_PENDENTE e nada é gravado; depois, importa (201 só contagens) com origem, hash e quem importou', async () => {
  assert.equal((await importLeitura2(ctx(qa3), imp([lei('a1')]))).status, 403, 'o QA 3 não importa');
  assert.equal((await importLeitura2(ctx(editor), imp([lei('a1')]))).status, 403);
  assert.equal((await importLeitura2(ctx(null), imp([lei('a1')]))).status, 401);
  const pend = await importLeitura2(ctx(dono), imp([lei('a1')]));
  assert.equal(pend.status, 409); assert.match(JSON.stringify(pend.body), /LEITOR1_PENDENTE/);
  assert.equal((await gravadas2()).length, 0);
  await leitor1('a1', [achado('baixa')]); await leitor1('a4');
  const r = await importLeitura2(ctx(dono), imp([lei('a1', [achado('media')]), lei('a4', [achado('baixa'), achado('baixa')])]));
  assert.equal(r.status, 201);
  assert.deepEqual(body<{ importadas: unknown[] }>(r).importadas, [
    { materia: 'a1', unsupportedFacts: 1, altas: 0, medias: 1, baixas: 0 }, { materia: 'a4', unsupportedFacts: 2, altas: 0, medias: 0, baixas: 2 },
  ]);
  assert.ok(!JSON.stringify(r.body).includes('trecho'), 'a resposta não devolve o conteúdo das leituras');
  const gravadas = await gravadas2();
  assert.equal(gravadas.length, 2);
  const l = JSON.parse(gravadas[0]!.detail!) as PilotoLeitura;
  assert.deepEqual([l.leitor, l.origem, l.importadoPor, l.leitor2Nome, l.arquivo!.sha256, l.arquivo!.nome], [2, 'importacao', 'dono', 'QA 3', SHA, 'folha-qa3.csv']);
  assert.equal(l.por, 'importado por dono da folha de QA 3');
  const trilha = (await store.listAudit()).map((a) => a.action);
  assert.ok(trilha.includes('piloto.importado') && trilha.includes('piloto.folha_recebida'));
  // imutável: o leitor 2 de a1 já existe (por importação, por outro arquivo ou pelo registro direto)
  assert.equal((await importLeitura2(ctx(dono), imp([lei('a1')]))).status, 409);
  assert.equal((await registerLeitura(ctx(qa3), { materia: 'a1', leitor: 2, achados: [], checklist: OK3, veredito: 'aprovado' })).status, 409);
  // a leitura importada conta no estado e no fechamento (divergência e cegueira usam os mesmos dados)
  const it = body<{ items: PilotoItem[] }>(await listPiloto(ctx(dono), {})).items.find((i) => i.materia === 'a1')!;
  assert.deepEqual(it.leituras, { leitor1: true, leitor2: true }); assert.equal(it.estado, 'lida');
});

test('tudo ou nada e as mesmas validações da leitura: aprovado com alta, evidenciaId alheia, matéria sem leitor 2, repetida, não gerada, campo extra, hash inválido', async () => {
  await leitor1('a1'); await leitor1('a4');
  const antes = (await store.listAudit()).filter((a) => a.action === 'piloto.leitura').length;
  const falha = async (x: unknown, status: number, re?: RegExp) => { const r = await importLeitura2(ctx(dono), x); assert.equal(r.status, status, JSON.stringify(r.body).slice(0, 220)); if (re) assert.match(JSON.stringify(r.body), re); };
  await falha(imp([lei('a1'), lei('a4', [achado('alta')])]), 400, /a4/);
  await falha(imp([lei('a1'), lei('a4', [achado('baixa', { evidenciaId: 'de_outro' })])]), 400, /evidenciaId/);
  await falha(imp([lei('a2')]), 400, /não tem leitor 2/);
  await falha(imp([lei('a1'), lei('a1')]), 400, /repetida/);
  await falha(imp([lei('a1')], { arquivo: { nome: 'x.csv', sha256: 'xyz', linhas: 1 } }), 400);
  await falha(imp([lei('a1')], { extra: 1 }), 400);
  await falha(imp([]), 400);
  await falha(imp([lei('a1', [achado('baixa', { trecho: 'x' })])]), 400);
  assert.equal((await gravadas2()).length, 0, 'nada gravado por nenhuma tentativa inválida');
  assert.equal((await store.listAudit()).filter((a) => a.action === 'piloto.leitura').length, antes);
  const bloqueada = await importLeitura2(ctx(dono), imp([lei('a1', [achado('alta')], { veredito: 'bloqueado', checklist: { ...OK3, fatosNasEvidencias: false } })]));
  assert.equal(bloqueada.status, 201); assert.equal(body<{ importadas: Array<{ altas: number }> }>(bloqueada).importadas[0]!.altas, 1);
  // matéria ainda não gerada (sem artigo mapeado)
  const s2 = new InMemoryEditorialStore(); store = s2; await s2.putArticle(sampleArticle('art-a1', { status: 'aprovado' }));
  await mapPiloto(ctx(dono), { a1: 'art-a1' });
  await falha(imp([lei('a6')]), 404, /ainda não foi gerada/);
});

test('folha: hash gravado no 1º envio (mesmo bloqueado), idempotente por sha256; outra folha = 409 FOLHA_DIFERENTE; GET /piloto traz hash e data da primeira', async () => {
  const reg = await registerFolha(ctx(dono), { arquivo: arquivo(), leitor2Nome: 'QA 3', materias: ['a1', 'a4'] });
  assert.equal(reg.status, 201);
  const primeira = body<{ registradoEm: string }>(reg).registradoEm;
  assert.equal((await registerFolha(ctx(dono), { arquivo: arquivo(), leitor2Nome: 'QA 3', materias: ['a1', 'a4'] })).status, 200, 'idempotente');
  assert.equal(body<{ registradoEm: string }>(await registerFolha(ctx(dono), { arquivo: arquivo(), leitor2Nome: 'QA 3', materias: ['a1'] })).registradoEm, primeira);
  assert.equal((await registerFolha(ctx(qa3), { arquivo: arquivo(), leitor2Nome: 'QA 3', materias: ['a1'] })).status, 403);
  assert.equal((await registerFolha(ctx(dono), { arquivo: arquivo(), leitor2Nome: 'QA 3', materias: ['a2'] })).status, 400, 'a2 não tem leitor 2');
  const dif = await registerFolha(ctx(dono), { arquivo: arquivo(SHA2), leitor2Nome: 'QA 3', materias: ['a4', 'a6'] });
  assert.equal(dif.status, 409); assert.match(JSON.stringify(dif.body), /FOLHA_DIFERENTE/);
  assert.equal((await store.listAudit()).filter((a) => a.action === 'piloto.folha_recebida').length, 1, 'a folha diferente não é registrada');
  const lista = body<{ items: PilotoItem[] }>(await listPiloto(ctx(qa3), {})).items;
  assert.deepEqual(lista.find((i) => i.materia === 'a1')!.folha, { sha256: SHA, em: primeira });
  assert.equal(lista.find((i) => i.materia === 'a6')!.folha, null); assert.equal(lista.find((i) => i.materia === 'a2')!.folha, null);
  // importação bloqueada (leitor 1 pendente): o hash do primeiro envio continua o mesmo e outro arquivo é recusado
  assert.match(JSON.stringify((await importLeitura2(ctx(dono), imp([lei('a1')]))).body), /LEITOR1_PENDENTE/);
  const outro = await importLeitura2(ctx(dono), imp([lei('a1')], { arquivo: arquivo(SHA2) }));
  assert.equal(outro.status, 409); assert.match(JSON.stringify(outro.body), /FOLHA_DIFERENTE/);
  assert.equal((await gravadas2()).length, 0);
});

test('sem registro prévio, o PRIMEIRO envio da importação grava o hash mesmo ficando bloqueado; depois do leitor 1, a mesma folha importa', async () => {
  const bloq = await importLeitura2(ctx(dono), imp([lei('a9')]));
  assert.equal(bloq.status, 409);
  assert.deepEqual((await store.listAudit()).filter((a) => a.action === 'piloto.folha_recebida').map((a) => a.target), [SHA]);
  await leitor1('a9');
  assert.equal((await importLeitura2(ctx(dono), imp([lei('a9')]))).status, 201);
  assert.equal((await store.listAudit()).filter((a) => a.action === 'piloto.folha_recebida').length, 1, 'não duplica o registro');
  assert.equal((await importLeitura2(ctx(dono), imp([lei('a9')]))).status, 409, 'o mesmo arquivo não entra duas vezes');
});

const MOTIVO = 'arquivo errado enviado por engano; o correto é outro (conferido com o QA 3)';

test('revogação da folha (R1 do QA 1): só admin/editor-chefe; motivo de 20+ caracteres; 404 se não está ativa; libera as matérias para o arquivo correto e deixa o histórico na trilha', async () => {
  const A = { arquivo: arquivo(SHA), leitor2Nome: 'QA 3', materias: ['a1', 'a4'] };
  assert.equal((await registerFolha(ctx(dono), A)).status, 201);
  assert.equal((await registerFolha(ctx(dono), { ...A, arquivo: arquivo(SHA2) })).status, 409, 'congelada: outro hash recusado');
  // permissão e validação
  assert.equal((await revogarFolha(ctx(null), { sha256: SHA, motivo: MOTIVO })).status, 401);
  assert.equal((await revogarFolha(ctx(qa3), { sha256: SHA, motivo: MOTIVO })).status, 403, 'o QA 3 (revisor) não revoga');
  assert.equal((await revogarFolha(ctx(editor), { sha256: SHA, motivo: MOTIVO })).status, 403);
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA, motivo: 'curto' })).status, 400, 'motivo obrigatório (20+)');
  assert.equal((await revogarFolha(ctx(dono), { sha256: 'xyz', motivo: MOTIVO })).status, 400);
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA, motivo: MOTIVO, extra: 1 })).status, 400);
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA2, motivo: MOTIVO })).status, 404, 'folha que nunca foi registrada');
  const antes = (await store.listAudit()).filter((a) => a.action === 'piloto.folha_revogada').length;
  assert.equal(antes, 0, 'nenhuma tentativa inválida grava');
  // revoga
  const r = await revogarFolha(ctx(dono), { sha256: SHA, motivo: MOTIVO });
  assert.equal(r.status, 200);
  assert.deepEqual(body<{ materiasLiberadas: string[] }>(r).materiasLiberadas, ['a1', 'a4']);
  assert.ok(!JSON.stringify(r.body).includes('QA 3'), 'a resposta não traz conteúdo da folha');
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA, motivo: MOTIVO })).status, 404, 'já revogada');
  // o estado ativo não tem mais a folha; o arquivo correto agora entra e vira a folha da matéria
  const lista0 = body<{ items: PilotoItem[] }>(await listPiloto(ctx(dono), {})).items;
  assert.equal(lista0.find((i) => i.materia === 'a1')!.folha, null);
  assert.equal((await registerFolha(ctx(dono), { ...A, arquivo: arquivo(SHA2) })).status, 201);
  const lista1 = body<{ items: PilotoItem[] }>(await listPiloto(ctx(dono), {})).items;
  assert.equal(lista1.find((i) => i.materia === 'a1')!.folha!.sha256, SHA2);
  // histórico preservado e revogação auditada com quem, quando e por quê
  const trilha = await store.listAudit();
  assert.deepEqual(trilha.filter((a) => a.action === 'piloto.folha_recebida').map((a) => a.target), [SHA, SHA2]);
  const rev = trilha.filter((a) => a.action === 'piloto.folha_revogada');
  assert.equal(rev.length, 1); assert.equal(rev[0]!.target, SHA);
  const det = JSON.parse(rev[0]!.detail!) as { motivo: string; por: string; materias: string[] };
  assert.deepEqual([det.motivo, det.por, det.materias], [MOTIVO, 'dono', ['a1', 'a4']]);
  // o mesmo hash revogado pode ser registrado de novo (era engano da revogação)
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA2, motivo: MOTIVO })).status, 200);
  assert.equal((await registerFolha(ctx(dono), A)).status, 201);
});

test('o caso do QA 1: importação BLOQUEADA no 1º envio congela a folha; revogar destrava e o arquivo correto importa depois do leitor 1', async () => {
  const bloq = await importLeitura2(ctx(dono), imp([lei('a1')])); // leitor 1 pendente: 409 LEITOR1_PENDENTE, mas o hash foi gravado
  assert.equal(bloq.status, 409);
  await leitor1('a1');
  const outro = await importLeitura2(ctx(dono), imp([lei('a1')], { arquivo: arquivo(SHA2) }));
  assert.equal(outro.status, 409); assert.match(JSON.stringify(outro.body), /FOLHA_DIFERENTE/, 'sem a revogação o arquivo correto seria recusado para sempre');
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA, motivo: MOTIVO })).status, 200);
  assert.equal((await importLeitura2(ctx(dono), imp([lei('a1')], { arquivo: arquivo(SHA2) }))).status, 201);
});

test('folha com leitura do leitor 2 já importada NÃO se revoga (409 FOLHA_COM_LEITURAS): a leitura é imutável e a folha é a prova dela', async () => {
  await leitor1('a1');
  assert.equal((await importLeitura2(ctx(dono), imp([lei('a1')]))).status, 201);
  const r = await revogarFolha(ctx(dono), { sha256: SHA, motivo: MOTIVO });
  assert.equal(r.status, 409); assert.match(JSON.stringify(r.body), /FOLHA_COM_LEITURAS/);
  assert.equal((await store.listAudit()).filter((a) => a.action === 'piloto.folha_revogada').length, 0);
  const it = body<{ items: PilotoItem[] }>(await listPiloto(ctx(dono), {})).items.find((i) => i.materia === 'a1')!;
  assert.deepEqual(it.folha && it.folha.sha256, SHA);
});

test('GET /piloto mostra a ÚLTIMA revogação da folha (quem, quando, por quê; só hash e motivo) no lugar de "sem folha"; some das matérias que ela não cobria; a mais recente vence', async () => {
  const A = { arquivo: arquivo(SHA), leitor2Nome: 'QA 3', materias: ['a1', 'a4'] };
  const itens = async (a: Actor) => body<{ items: PilotoItem[] }>(await listPiloto(ctx(a), {})).items;
  assert.equal((await itens(qa3)).find((i) => i.materia === 'a1')!.folhaRevogada, null, 'nunca houve revogação');
  assert.equal((await registerFolha(ctx(dono), A)).status, 201);
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA, motivo: MOTIVO })).status, 200);
  for (const quem of [dono, qa3]) {
    const l = await itens(quem);
    const a1 = l.find((i) => i.materia === 'a1')!;
    assert.equal(a1.folha, null);
    assert.deepEqual(a1.folhaRevogada, { sha256: SHA, por: 'dono', em: NOW.toISOString(), motivo: MOTIVO });
    assert.deepEqual(l.find((i) => i.materia === 'a4')!.folhaRevogada, a1.folhaRevogada);
    assert.equal(l.find((i) => i.materia === 'a6')!.folhaRevogada, null, 'a6 não estava na folha revogada');
    assert.deepEqual(Object.keys(a1.folhaRevogada!).sort(), ['em', 'motivo', 'por', 'sha256'], 'só hash, quem, quando e motivo');
    assert.ok(!JSON.stringify(a1).includes('folha-qa3.csv'), 'nem o nome do arquivo');
  }
  // nova folha entra: a folha ativa volta e a revogação anterior continua visível ao lado; uma 2ª revogação (outro motivo) vira a "última"
  assert.equal((await registerFolha(ctx(dono), { ...A, arquivo: arquivo(SHA2) })).status, 201);
  const motivo2 = 'segunda folha também veio com o cabeçalho errado; refeita pelo QA 3';
  assert.equal((await revogarFolha(ctx(dono), { sha256: SHA2, motivo: motivo2 })).status, 200);
  const a1 = (await itens(dono)).find((i) => i.materia === 'a1')!;
  assert.equal(a1.folha, null); assert.deepEqual([a1.folhaRevogada!.sha256, a1.folhaRevogada!.motivo], [SHA2, motivo2]);
});
