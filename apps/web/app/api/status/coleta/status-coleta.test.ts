// GET /api/status/coleta sobre o PostgreSQL de teste. Dados MOCK.
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import type { Db } from '@ln/auth';
import { COLLECTOR_ALERT_ACTION, COLLECTOR_ROUND_ACTION, COLLECTOR_SOURCES_ACTION, ROUND_STALE_AFTER_MS, describeRound, type AuditItem, type InboxRound } from '@ln/editorial';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { setDepsForTest, type Deps } from '../../_lib/deps';
import { CACHE_FALHA_MS, CACHE_MS, PRAZO_DA_CONSULTA_MS, limparCacheDaColetaParaTeste } from '../../_lib/status-coleta';
import { GET } from './route';

const AGORA = new Date('2026-12-02T12:00:00.000Z');
const HORA = 3_600_000;
const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let relogio = AGORA;
beforeAll(async () => { t = await createTestDb(); db = t.db as unknown as Db; }, 120_000);
afterAll(async () => { await t.close(); });
afterEach(() => { setDepsForTest(null); limparCacheDaColetaParaTeste(); relogio = AGORA; vi.restoreAllMocks(); vi.useRealTimers(); });

const usar = (banco: Db = db) => setDepsForTest({ db: banco, now: () => relogio } as unknown as Deps);
const ler = async () => { const r = await GET(); return { status: r.status, cache: r.headers.get('cache-control'), texto: await r.clone().text(), corpo: await r.json() as Record<string, unknown> }; };
const grava = (a: Partial<AuditItem> & { at: string }) => new PgEditorialStore(db).appendAudit({ userId: null, action: COLLECTOR_ROUND_ACTION, target: 'collector', ...a });
const rodada = (evidences: number): InboxRound => ({ startedAt: '', finishedAt: '', saved: [], duplicates: 0, sources: [{ sourceId: 'mock-fonte-secreta', status: 'collected', evidences, saved: 0, skipped: [] }] });

// A trilha é só de acréscimo: os casos vão na ordem em que ela cresce.
describe('GET /api/status/coleta', () => {
  it('sem nenhuma rodada boa: 503 nunca; aviso, fontes, rodada sem item e registro com usuário não contam', async () => {
    await grava({ at: antes(HORA), detail: describeRound(rodada(0)) });
    await grava({ at: antes(HORA), action: COLLECTOR_SOURCES_ACTION, detail: 'rodada boa; MOCK em outra ação' });
    await grava({ at: antes(HORA), action: COLLECTOR_ALERT_ACTION, detail: 'rodada boa; MOCK aviso' });
    await grava({ at: antes(HORA), userId: 'mock-pessoa', detail: 'rodada boa; MOCK gravada por usuário' });
    await grava({ at: antes(HORA), detail: 'MOCK menciona rodada boa; no meio' });
    usar();
    expect(await ler()).toMatchObject({ status: 503, cache: 'no-store', corpo: { estado: 'nunca', ultimaRodadaBoaEm: null } });
  });

  it('rodada boa recente: 200 ok, só com estado e horário; exatamente 5 h ainda é ok e depois vira atrasada', async () => {
    const boa = antes(ROUND_STALE_AFTER_MS);
    await grava({ at: boa, detail: describeRound(rodada(3)) });
    await grava({ at: antes(HORA), detail: describeRound(rodada(0)) }); // rodada sem item, mais nova, não renova o prazo
    usar();
    const r = await ler();
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ estado: 'ok', ultimaRodadaBoaEm: boa });
    expect(r.texto).not.toMatch(/mock|fonte|rodada boa;|collector/i);
    relogio = new Date(AGORA.getTime() + 1);
    expect(await ler()).toMatchObject({ status: 503, corpo: { estado: 'atrasada', ultimaRodadaBoaEm: boa } });
  });

  it('guarda a leitura por um minuto, recalculando o prazo a cada pedido', async () => {
    const consulta = vi.spyOn(PgEditorialStore.prototype, 'lastGoodRoundAt');
    usar();
    relogio = new Date(AGORA.getTime() - 1000);
    await ler();
    await Promise.all([ler(), ler()]);
    relogio = new Date(AGORA.getTime() + 1000);
    expect((await ler()).corpo).toMatchObject({ estado: 'atrasada' });
    expect(consulta).toHaveBeenCalledTimes(1);
    const nova = antes(60_000);
    await grava({ at: nova, detail: describeRound(rodada(1)) });
    relogio = new Date(AGORA.getTime() - 1000 + CACHE_MS);
    expect(await ler()).toMatchObject({ status: 200, corpo: { estado: 'ok', ultimaRodadaBoaEm: nova } });
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('banco fora: 503 indisponivel sem repetir o erro; a falha também é guardada, por menos tempo', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consulta = vi.spyOn(PgEditorialStore.prototype, 'lastGoodRoundAt').mockRejectedValue(new Error('MOCK host-secreto.mock.example recusou a senha'));
    usar();
    const r = await ler();
    expect(r).toMatchObject({ status: 503, cache: 'no-store', corpo: { estado: 'indisponivel', ultimaRodadaBoaEm: null } });
    expect(r.texto).not.toMatch(/secreto|senha|MOCK/);
    await ler();
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    relogio = new Date(AGORA.getTime() + CACHE_FALHA_MS);
    consulta.mockRestore();
    expect((await ler()).corpo).toMatchObject({ estado: 'ok' });
  });

  it('consulta que não responde: indisponivel depois do prazo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(PgEditorialStore.prototype, 'lastGoodRoundAt').mockReturnValue(new Promise<never>(() => {}));
    vi.useFakeTimers();
    usar();
    const pedido = GET();
    await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_MS);
    expect((await pedido).status).toBe(503);
  });

  it('banco travado: uma só consulta em curso por mais que o cache vença; terminada ela, consulta de novo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let terminar!: (v: string | null) => void;
    const consulta = vi.spyOn(PgEditorialStore.prototype, 'lastGoodRoundAt').mockImplementationOnce(() => new Promise((ok) => { terminar = ok; }));
    vi.useFakeTimers();
    usar();
    for (let i = 0; i < 6; i += 1) { // 60 s com o banco travado
      relogio = new Date(AGORA.getTime() + i * CACHE_FALHA_MS);
      const pedido = GET();
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_MS);
      expect((await pedido).status).toBe(503);
    }
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(consulta).toHaveBeenCalledWith(PRAZO_DA_CONSULTA_MS);
    vi.useRealTimers();
    terminar(null);
    await new Promise((ok) => setTimeout(ok, 0));
    relogio = new Date(AGORA.getTime() + 6 * CACHE_FALHA_MS);
    expect((await ler()).corpo).toMatchObject({ estado: 'ok' });
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('o banco cancela a consulta no prazo, e só nesta transação', async () => {
    const prazo = async (alvo: Pick<Db, 'execute'>) => ((await alvo.execute(sql`select current_setting('statement_timeout') as v`)) as unknown as { rows: Array<{ v: string }> }).rows[0]!.v;
    const antesDe = await prazo(db);
    let dentro = '';
    const espiao = { transaction: (f: (tx: unknown) => Promise<unknown>) => db.transaction(async (tx) => { const r = await f(tx); dentro = await prazo(tx as unknown as Db); return r; }) } as unknown as Db;
    expect(await new PgEditorialStore(espiao).lastGoodRoundAt(1500)).not.toBeNull();
    expect(dentro).toBe('1500ms');
    expect(await prazo(db)).toBe(antesDe);
  });

  it('sem banco configurado: 503 indisponivel', async () => {
    const guardada = process.env.APP_MODE;
    process.env.APP_MODE = 'nodb';
    try {
      expect(await ler()).toMatchObject({ status: 503, corpo: { estado: 'indisponivel', ultimaRodadaBoaEm: null } });
    } finally {
      if (guardada === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = guardada;
    }
  });
});
