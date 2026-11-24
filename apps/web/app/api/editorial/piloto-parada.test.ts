/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canDispatchNext } from '@ln/agents';
import { sampleArticle } from '@ln/editorial/testing';
import type { PilotRow } from '@ln/openbot';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { PgPilotRowStore } from '@ln/workers/openbot-pg';
import { call, makeApp } from '../_lib/testkit';
import { dispatchEditorial as d } from '../_lib/editorial';
import { linhasDaMateria } from '../_lib/editorial/piloto-parada';

// Parada do piloto no 1º fato ALTO (critério 2 do PM, 24/11): a leitura do leitor 1 vai para a linha do piloto no banco e o canDispatchNext do kit
// (o mesmo que o despacho usa nas linhas do PgPilotRowStore) passa a recusar. Rota oficial com sessão, MFA e RBAC.
let app: Awaited<ReturnType<typeof makeApp>>;
let rows: PgPilotRowStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let revisor: Awaited<ReturnType<typeof app.actor>>;
const S = (p: string) => `/api/studio/editorial${p}`;
const OK = { fatosNasEvidencias: true, tom: true, nadaInventado: true };
const linha = (over: Partial<PilotRow>): PilotRow =>
  ({
    task_id: 't', kind: 'editorial_draft', article_id: 'x', source_id: 's1', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet', prompt_version: 'editorial-0.3',
    started_at: '2026-11-24T12:00:00.000Z', ended_at: '2026-11-24T12:05:00.000Z', attempt: 1, outcome: 'completed', packet_chars: 1200, tokens_measured: false,
    published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
  }) as PilotRow;
const linhaDe = async (taskId: string) => (await rows.all()).find((r) => r.task_id === taskId)!;

beforeAll(async () => {
  app = await makeApp();
  const store = new PgEditorialStore(app.db);
  rows = new PgPilotRowStore(app.db);
  [chefe, revisor] = [await app.actor('editor_chefe'), await app.actor('revisor')];
  for (const id of ['art-a1', 'art-a2', 'art-a4']) await store.putArticle(sampleArticle(id, { status: 'aprovado' }));
  await rows.upsert(linha({ task_id: 'a1-draft', article_id: 'art-a1', stage: 'draft' }));
  await rows.upsert(linha({ task_id: 'a1-review', article_id: 'art-a1', stage: 'review', started_at: '2026-11-24T12:10:00.000Z', gate_verdict: 'approved', cross_provider_ok: true, output_valid: true } as Partial<PilotRow>));
  await rows.upsert(linha({ task_id: 'a2-draft', article_id: 'art-a2', stage: 'draft', started_at: '2026-11-24T13:00:00.000Z' }));
  expect((await call(d, 'POST', { path: S('/piloto/mapa'), body: { a1: 'art-a1', a2: 'art-a2', a4: 'art-a4' }, as: chefe })).status).toBe(201);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('linhasDaMateria', () => {
  it('as linhas finais (review/check_edit) do artigo; sem elas, a última linha do artigo; sem linha, nenhuma', () => {
    const rs = [linha({ task_id: 'd', article_id: 'A', stage: 'draft' }), linha({ task_id: 'r', article_id: 'A', stage: 'review' }), linha({ task_id: 'd2', article_id: 'B', stage: 'draft', started_at: '2026-11-24T14:00:00.000Z' }), linha({ task_id: 'd1', article_id: 'B', stage: 'draft' })];
    expect(linhasDaMateria(rs, 'A').map((r) => r.task_id)).toEqual(['r']);
    expect(linhasDaMateria(rs, 'B').map((r) => r.task_id)).toEqual(['d2']);
    expect(linhasDaMateria(rs, 'C')).toEqual([]);
  });
});

describe('POST /piloto/:materia/leitura grava a leitura do leitor 1 na linha do piloto', () => {
  it('antes da leitura não há motivo de parada por fato ALTO', async () => {
    // as linhas de teste não preenchem todos os campos que o kit exige (o gate pode recusar por isso); o que importa aqui é o motivo de fato ALTO
    expect(canDispatchNext((await rows.all()) as any).reasons.join(' ')).not.toMatch(/gravidade ALTA/);
  });

  it('fato ALTO do editor-chefe: grava unsupported_* na linha final da matéria e o canDispatchNext para no próximo pull', async () => {
    const r = await call(d, 'POST', { path: S('/piloto/a1/leitura'), body: { leitor: 1, achados: [{ trecho: 'a taxa é de 3%', tipo: 'numero', gravidade: 'alta', evidenciaId: 'ev_1' }], checklist: OK, veredito: 'bloqueado' }, as: chefe });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ materia: 'a1', leitor: 1, altas: 1, planilha: { linhas: ['a1-review#1'], parada: true, erros: [] } });
    expect(await linhaDe('a1-review')).toMatchObject({ unsupported_facts: 1, unsupported_high: 1, unsupported_medium: 0, unsupported_low: 0, gate_verdict: 'approved' });
    expect((await linhaDe('a1-draft')).unsupported_facts).toBeUndefined(); // só a linha final recebe a leitura
    const gate = canDispatchNext((await rows.all()) as any);
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/a1-review: fato não suportado de gravidade ALTA/);
  });

  it('leitor 2 não mexe na linha (a leitura do leitor 1 continua valendo)', async () => {
    const r = await call(d, 'POST', { path: S('/piloto/a1/leitura'), body: { leitor: 2, achados: [], checklist: OK, veredito: 'aprovado' }, as: revisor });
    expect(r.status).toBe(201);
    expect((r.body as any).planilha).toBeUndefined();
    expect(await linhaDe('a1-review')).toMatchObject({ unsupported_high: 1 });
  });

  it('leitura sem fato alto também é gravada (sem parada); sem linha final, vai para a última linha do artigo', async () => {
    const r = await call(d, 'POST', { path: S('/piloto/a2/leitura'), body: { leitor: 1, achados: [{ trecho: 'contexto genérico', tipo: 'contexto', gravidade: 'baixa' }], checklist: OK, veredito: 'aprovado' }, as: chefe });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ planilha: { linhas: ['a2-draft#1'], parada: false, erros: [] } });
    expect(await linhaDe('a2-draft')).toMatchObject({ unsupported_facts: 1, unsupported_high: 0, unsupported_low: 1 });
  });

  it('matéria sem linha do piloto: a leitura é registrada e a resposta avisa que não há linha para gravar', async () => {
    const r = await call(d, 'POST', { path: S('/piloto/a4/leitura'), body: { leitor: 1, achados: [{ trecho: 'valor errado aqui', tipo: 'valor', gravidade: 'alta' }], checklist: OK, veredito: 'bloqueado' }, as: chefe });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ planilha: { linhas: [], parada: true, erros: [], aviso: expect.stringMatching(/nenhuma linha do piloto/) } });
  });
});

describe('falha do banco ao gravar na linha (ressalva 3 do QA 9)', () => {
  it('a leitura fica registrada, a falha volta em planilha.erros (201, não 500) e a linha não muda', async () => {
    const store = new PgEditorialStore(app.db);
    await store.putArticle(sampleArticle('art-a6', { status: 'aprovado' }));
    await rows.upsert(linha({ task_id: 'a6-review', article_id: 'art-a6', stage: 'review', started_at: '2026-11-24T15:00:00.000Z' }));
    expect((await call(d, 'POST', { path: S('/piloto/mapa'), body: { a6: 'art-a6' }, as: chefe })).status).toBe(201);
    const spy = vi.spyOn(PgPilotRowStore.prototype, 'patch').mockRejectedValueOnce(new Error('falha simulada do banco'));
    try {
      const r = await call(d, 'POST', { path: S('/piloto/a6/leitura'), body: { leitor: 1, achados: [{ trecho: 'valor errado aqui', tipo: 'valor', gravidade: 'alta' }], checklist: OK, veredito: 'bloqueado' }, as: chefe });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ materia: 'a6', altas: 1, planilha: { linhas: [], parada: true, erros: [expect.stringMatching(/falha simulada do banco/)] } });
    } finally {
      spy.mockRestore();
    }
    const ls = await call(d, 'GET', { path: S('/piloto/a6/leituras'), as: chefe });
    expect(ls.body.leituras.map((l: any) => l.leitor)).toEqual([1]); // a leitura não foi desfeita
    expect((await linhaDe('a6-review')).unsupported_high).toBeUndefined();
  });
});