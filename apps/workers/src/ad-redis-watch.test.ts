import IORedis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@ln/auth';
import { schema } from '@ln/db';
import { assertLocalTestHost, createTestDb } from '@ln/db/testing';
import { DeliveryAudit, IMPRESSION_TTL_MS, VIEW_TTL_MS } from '@ln/commercial';
import { addGapCounts, gapsSnapshot, loadGaps, readWatermark, saveGap, writeWatermark } from './ad-gaps';
import { describeHeartbeat, HB_DOWN_ID, HB_KEY, HB_RUN_ID, heartbeatOnce, startAdRedisWatch, type HeartbeatRedis } from './ad-redis-watch';

// Padrão: ioredis-mock. Com LN_TEST_REDIS_URL (Redis LOCAL de teste: o teste faz flushall) usa Redis REAL.
const REAL_REDIS_URL = process.env.LN_TEST_REDIS_URL;
if (REAL_REDIS_URL) assertLocalTestHost(REAL_REDIS_URL, 'LN_TEST_REDIS_URL');

const T0 = Date.parse('2026-11-24T12:00:00.000Z');
const at = (min: number) => () => new Date(T0 + min * 60_000);
const MIN = 60_000;

type R = HeartbeatRedis & { flushall(): Promise<unknown>; set(k: string, v: string): Promise<unknown> };
let redis: R;
let t: Awaited<ReturnType<typeof createTestDb>>;
const db = () => t.db as unknown as Db;
const rows = () => t.client.query<{ id: string; reason: string; uncounted_serves: number; ignored_events: number }>('SELECT id, reason, uncounted_serves, ignored_events FROM ad_delivery_gaps ORDER BY id');
// `beat` não consulta o INFO: testa só o watermark (a geração do processo tem a sua seção, com run_id controlado)
const noInfo = (): HeartbeatRedis => ({ get: (k) => redis.get(k), incr: (k) => redis.incr(k), del: (k) => redis.del(k) });
const beat = (min: number) => heartbeatOnce(db(), noInfo(), { now: at(min) });

beforeEach(async () => {
  t = await createTestDb();
  redis = (REAL_REDIS_URL ? new IORedis(REAL_REDIS_URL, { maxRetriesPerRequest: 2 }) : new RedisMock()) as unknown as R;
  await redis.flushall();
}, 120_000);
afterEach(async () => {
  if (REAL_REDIS_URL) await (redis as unknown as { quit: () => Promise<unknown> }).quit().catch(() => undefined);
  await t.close();
});
afterAll(() => undefined);

describe('heartbeatOnce: Redis saudável', () => {
  it('primeira batida = baseline; as seguintes = saudável, o espelho sobe e o horário acompanha; nenhuma lacuna', async () => {
    expect(await beat(0)).toEqual({ state: 'baseline', value: 1 });
    expect(await beat(1)).toEqual({ state: 'healthy', value: 2 });
    expect(await beat(2)).toEqual({ state: 'healthy', value: 3 });
    const w = await readWatermark(db(), HB_KEY);
    expect(w?.value).toBe(3);
    expect(w?.at.toISOString()).toBe(new Date(T0 + 2 * MIN).toISOString());
    expect((await rows()).rows).toEqual([]);
  });

  it('valor igual ao do espelho (restaurado exatamente no último ponto) = saudável: a regra é "menor", não "diferente"', async () => {
    await beat(0);
    await beat(1); // espelho = 2
    await redis.set(HB_KEY, '2');
    expect(await beat(2)).toEqual({ state: 'healthy', value: 3 });
    expect((await rows()).rows).toEqual([]);
  });
});

describe('heartbeatOnce: perda e regressão', () => {
  it('FLUSHALL: chave ausente → dedupe_perdido; a lacuna vai a ad_delivery_gaps com as janelas do domínio; o espelho recomeça no valor atual', async () => {
    await beat(0);
    await beat(1);
    await beat(2); // última batida saudável: 2 min
    await redis.flushall();
    const r = await beat(5); // detectada aos 5 min
    expect(r).toMatchObject({ state: 'loss', reason: 'dedupe_perdido', cause: 'chave_ausente', value: 1 });
    const [g] = await loadGaps(db());
    expect(g).toMatchObject({ id: 'gap-1', reason: 'dedupe_perdido', uncountedServes: 0, ignoredEvents: 0 });
    expect(g!.from).toBe(new Date(T0 + 2 * MIN).toISOString()); // última vez comprovadamente saudável
    expect(g!.detectedAt).toBe(new Date(T0 + 5 * MIN).toISOString());
    expect(Date.parse(g!.servedUntil)).toBe(T0 + 5 * MIN + VIEW_TTL_MS);
    expect(Date.parse(g!.to)).toBe(T0 + 5 * MIN + IMPRESSION_TTL_MS);
    expect((await readWatermark(db(), HB_KEY))?.value).toBe(1);
    // a batida seguinte NÃO acusa de novo (senão cada minuto abriria outra lacuna)
    expect(await beat(6)).toEqual({ state: 'healthy', value: 2 });
    expect((await rows()).rows).toHaveLength(1);
  });

  it('restauração de um ponto antigo (valor menor que o espelho) → dedupe_regrediu', async () => {
    for (let i = 0; i < 10; i++) await beat(i); // espelho = 10
    await redis.set(HB_KEY, '4'); // backup antigo
    const r = await beat(10);
    expect(r).toMatchObject({ state: 'loss', reason: 'dedupe_regrediu', cause: 'regrediu', value: 5 });
    expect((await rows()).rows).toEqual([expect.objectContaining({ id: 'gap-1', reason: 'dedupe_regrediu' })]);
    expect((await readWatermark(db(), HB_KEY))?.value).toBe(5); // recomeça do valor atual, não do GREATEST
    expect((await beat(11)).state).toBe('healthy');
  });

  it('valor que não é inteiro na chave é tratado como perda: a chave é apagada e recomeça (o INCR falharia para sempre)', async () => {
    await beat(0);
    await redis.set(HB_KEY, 'lixo');
    expect(await beat(1)).toMatchObject({ state: 'loss', reason: 'dedupe_perdido', cause: 'invalido', value: 1 });
    expect((await beat(2)).state).toBe('healthy');
  });

  it('sem espelho (primeira vez) e chave ausente não é perda: é a subida inicial', async () => {
    expect((await beat(0)).state).toBe('baseline');
    expect((await rows()).rows).toEqual([]);
  });

  it('nova perda durante a janela aberta FUNDE na mesma lacuna (mesma linha, id estável), alarga as janelas e preserva os contadores', async () => {
    await beat(0);
    await redis.flushall();
    await beat(10); // gap-1 aberta aos 10 min
    expect(await addGapCounts(db(), 'gap-1', { uncountedServes: 7, ignoredEvents: 3 })).toBe(true);
    await redis.flushall();
    const r = await beat(20); // nova perda 10 min depois, ainda dentro das janelas
    expect(r).toMatchObject({ state: 'loss', gap: { id: 'gap-1' } });
    const { rows: all } = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'gap-1', uncounted_serves: 7, ignored_events: 3 }); // o monitor não zera o que o caminho público contou
    const [g] = await loadGaps(db());
    expect(Date.parse(g!.to)).toBe(T0 + 20 * MIN + IMPRESSION_TTL_MS);
    expect(g!.detectedAt).toBe(new Date(T0 + 20 * MIN).toISOString());
  });

  it('perda depois de uma lacuna JÁ ENCERRADA abre outra com o próximo id (gap-2), sem sobrescrever a antiga', async () => {
    await beat(0);
    await redis.flushall();
    await beat(10);
    await addGapCounts(db(), 'gap-1', { uncountedServes: 4 });
    await beat(11); // saudável
    await beat(10 + 24 * 60 - 1); // saudável um dia depois: a janela da primeira já encerrou
    await redis.flushall();
    await beat(10 + 24 * 60);
    const { rows: all } = await rows();
    expect(all.map((x) => x.id)).toEqual(['gap-1', 'gap-2']);
    expect(all[0]!.uncounted_serves).toBe(4);
  });

  it('dois monitores batendo AO MESMO TEMPO sobre um Redis perdido abrem UMA lacuna só (trava no banco)', async () => {
    await beat(0);
    await redis.flushall();
    const [a, b] = await Promise.all([beat(5), beat(5)]);
    expect([a.state, b.state].sort()).toEqual(['healthy', 'loss']); // quem entra depois já encontra o espelho reajustado
    expect((await rows()).rows).toHaveLength(1);
  });
});

describe('heartbeatOnce: Redis inacessível', () => {
  const down: HeartbeatRedis = {
    get: () => Promise.reject(new Error('ECONNREFUSED redis')),
    incr: () => Promise.reject(new Error('ECONNREFUSED redis')),
    del: () => Promise.reject(new Error('ECONNREFUSED redis')),
  };

  it('inacessível: grava o início uma vez e continua inacessível; ao voltar (mesmo com dados intactos) abre lacuna dedupe_perdido com from = última batida', async () => {
    await beat(0);
    await beat(1); // última batida registrada: 1 min
    const a = await heartbeatOnce(db(), down, { now: at(2) });
    expect(a).toEqual({ state: 'unreachable', since: new Date(T0 + 2 * MIN).toISOString() });
    const b = await heartbeatOnce(db(), down, { now: at(3) });
    expect(b).toEqual({ state: 'unreachable', since: new Date(T0 + 2 * MIN).toISOString() }); // o início não se move
    expect((await readWatermark(db(), HB_KEY))?.value).toBe(2); // o espelho não mexe
    expect((await rows()).rows).toEqual([]); // enquanto está fora, o ad server serve sem contar; a lacuna nasce na volta

    const back = await beat(8); // Redis voltou com a chave intacta (2 → 3)
    expect(back).toMatchObject({ state: 'loss', reason: 'dedupe_perdido', cause: 'indisponibilidade' });
    const [g] = await loadGaps(db());
    expect(g!.from).toBe(new Date(T0 + 1 * MIN).toISOString());
    expect(g!.detectedAt).toBe(new Date(T0 + 8 * MIN).toISOString());
    expect((await readWatermark(db(), HB_DOWN_ID))).toBeNull(); // marca de indisponibilidade encerrada
    expect((await beat(9)).state).toBe('healthy');
    expect((await rows()).rows).toHaveLength(1);
  });

  it('comando que nunca responde: o tempo esgota e vira inacessível (a conexão do worker espera para sempre sem isso)', async () => {
    const hang: HeartbeatRedis = { get: () => new Promise(() => undefined), incr: () => new Promise(() => undefined), del: () => new Promise(() => undefined) };
    await beat(0);
    const r = await heartbeatOnce(db(), hang, { now: at(1), timeoutMs: 25 });
    expect(r.state).toBe('unreachable');
  });

  it('inacessível na primeira batida (sem espelho) e depois volta: lacuna com from = início da indisponibilidade', async () => {
    await heartbeatOnce(db(), down, { now: at(0) });
    const r = await beat(4);
    expect(r).toMatchObject({ state: 'loss', cause: 'indisponibilidade' });
    expect((await loadGaps(db()))[0]!.from).toBe(new Date(T0).toISOString());
  });
});

// Geração do processo Redis (run_id do INFO): ponto cego do watermark e falso positivo de indisponibilidade transitória.
describe('heartbeatOnce: geração do processo (run_id)', () => {
  const hex = (n: number) => n.toString(16).padStart(12, '0') + '0'.repeat(28);
  let run = 1;
  const withRun = (): HeartbeatRedis => ({
    ...noInfo(),
    info: async () => `# Server
redis_version:8.2.1
run_id:${hex(run)}
uptime_in_seconds:5
`,
  });
  const gen = (min: number, r: HeartbeatRedis = withRun()) => heartbeatOnce(db(), r, { now: at(min) });
  const down: HeartbeatRedis = { get: () => Promise.reject(new Error('x')), incr: () => Promise.reject(new Error('x')), del: () => Promise.reject(new Error('x')) };
  beforeEach(() => { run = 1; });

  it('grava a geração a cada batida e não acusa nada enquanto o processo é o mesmo', async () => {
    expect((await gen(0)).state).toBe('baseline');
    expect((await gen(1)).state).toBe('healthy');
    expect((await readWatermark(db(), HB_RUN_ID))?.value).toBe(1);
    expect((await rows()).rows).toEqual([]);
  });

  it('PONTO CEGO FECHADO: backup restaurado no último ponto (chave = espelho) com outro processo ⇒ lacuna dedupe_regrediu (antes: "saudável")', async () => {
    await gen(0);
    await gen(1); // espelho = 2
    await redis.set(HB_KEY, '2'); // restaurado exatamente no último ponto
    run = 2; // processo novo (restauração, reinício ou failover)
    const r = await gen(2);
    expect(r).toMatchObject({ state: 'loss', reason: 'dedupe_regrediu', cause: 'reinicio' });
    expect((await rows()).rows).toEqual([expect.objectContaining({ id: 'gap-1', reason: 'dedupe_regrediu' })]);
    expect((await readWatermark(db(), HB_RUN_ID))?.value).toBe(2); // a nova geração vira a referência
    expect((await gen(3)).state).toBe('healthy'); // e a batida seguinte não acusa de novo
    expect((await rows()).rows).toHaveLength(1);
  });

  it('o mesmo valor com o MESMO processo continua saudável (o teste do ponto cego não é falso positivo)', async () => {
    await gen(0);
    await gen(1);
    await redis.set(HB_KEY, '2');
    expect((await gen(2)).state).toBe('healthy');
  });

  it('indisponibilidade transitória: volta o MESMO processo com a chave intacta ⇒ recovered, SEM lacuna, marca encerrada', async () => {
    await gen(0);
    await gen(1);
    expect((await gen(2, down)).state).toBe('unreachable');
    expect((await readWatermark(db(), HB_DOWN_ID))).not.toBeNull();
    expect(await gen(8)).toEqual({ state: 'recovered', value: 3 });
    expect((await readWatermark(db(), HB_DOWN_ID))).toBeNull();
    expect((await rows()).rows).toEqual([]);
    expect((await gen(9)).state).toBe('healthy');
  });

  it('indisponibilidade e o processo mudou ⇒ lacuna (reinício); indisponibilidade e a chave sumiu ⇒ lacuna (chave ausente)', async () => {
    await gen(0);
    await gen(1);
    await gen(2, down);
    run = 2;
    expect(await gen(5)).toMatchObject({ state: 'loss', cause: 'reinicio' });
    expect((await readWatermark(db(), HB_DOWN_ID))).toBeNull();
    await gen(6);
    await gen(7, down);
    await redis.flushall(); // mesmo processo, mas esvaziado
    expect(await gen(9)).toMatchObject({ state: 'loss', cause: 'chave_ausente' });
  });

  it('sem prova de continuidade (INFO sem run_id, ou sem espelho de geração ainda) a indisponibilidade continua abrindo lacuna', async () => {
    await gen(0, { ...withRun(), info: undefined }); // sem INFO: nenhuma geração gravada
    await gen(1, down);
    expect(await gen(2)).toMatchObject({ state: 'loss', cause: 'indisponibilidade' }); // INFO ok agora, mas sem referência anterior
  });

  it('INFO que falha ou devolve lixo não derruba a batida: só vale o watermark', async () => {
    await gen(0);
    expect((await gen(1, { ...withRun(), info: () => Promise.reject(new Error('NOPERM')) })).state).toBe('healthy');
    expect((await gen(2, { ...withRun(), info: async () => 'sem run_id aqui' })).state).toBe('healthy');
    expect((await readWatermark(db(), HB_RUN_ID))?.value).toBe(1); // sem leitura, a referência não muda
  });

  it('o INFO REAL do Redis (ou do mock) é lido: a geração fica gravada e não muda de uma batida para a outra', async () => {
    const real = redis as unknown as HeartbeatRedis;
    await heartbeatOnce(db(), real, { now: at(0) });
    const first = (await readWatermark(db(), HB_RUN_ID))?.value;
    expect(first).toBeGreaterThan(0);
    expect(Number.isSafeInteger(first)).toBe(true);
    expect((await heartbeatOnce(db(), real, { now: at(1) })).state).toBe('healthy');
    expect((await readWatermark(db(), HB_RUN_ID))?.value).toBe(first);
  });

  it('o log de recuperação não carrega segredo', () => {
    expect(describeHeartbeat({ state: 'recovered', value: 3 })).toBe('redis voltou com o mesmo processo e o estado intacto (3); sem lacuna');
  });
});

describe('contrato com o consumidor da tabela (Commercial)', () => {
  it('loadGaps(activeAt) devolve só as que ainda valem; gapsSnapshot alimenta DeliveryAudit.load e suspende nos limites exatos', async () => {
    await beat(0);
    await redis.flushall();
    await beat(10);
    const detected = T0 + 10 * MIN;
    expect(await loadGaps(db(), { activeAt: new Date(detected + IMPRESSION_TTL_MS - 1) })).toHaveLength(1);
    expect(await loadGaps(db(), { activeAt: new Date(detected + IMPRESSION_TTL_MS) })).toHaveLength(0); // `to` é exclusivo
    const audit = new DeliveryAudit();
    audit.load(gapsSnapshot(await loadGaps(db())));
    expect(audit.servingSuspended(detected + VIEW_TTL_MS - 1)).toBe(true);
    expect(audit.servingSuspended(detected + VIEW_TTL_MS)).toBe(false);
    expect(audit.eventsSuspended(detected + IMPRESSION_TTL_MS - 1)).toBe(true);
    expect(audit.eventsSuspended(detected + IMPRESSION_TTL_MS)).toBe(false);
    expect(audit.eventsSuspended(detected - 1)).toBe(false); // antes da detecção nada muda
  });

  it('gapsSnapshot.seq = maior N: o domínio nunca reaproveita id', async () => {
    const g = (id: string) => ({ id, reason: 'dedupe_perdido' as const, from: '2026-11-01T00:00:00.000Z', servedUntil: '2026-11-01T00:30:00.000Z', to: '2026-11-01T02:00:00.000Z', detectedAt: '2026-11-01T00:00:00.000Z', uncountedServes: 0, ignoredEvents: 0 });
    expect(gapsSnapshot([g('gap-3'), g('gap-12'), g('gap-7')]).seq).toBe(12);
    expect(gapsSnapshot([]).seq).toBe(0);
  });

  it('addGapCounts é atômico (20 somas concorrentes = +20), recusa negativo/fracionário e devolve false para lacuna inexistente', async () => {
    await beat(0);
    await redis.flushall();
    await beat(1);
    await Promise.all(Array.from({ length: 20 }, () => addGapCounts(db(), 'gap-1', { uncountedServes: 1, ignoredEvents: 2 })));
    expect((await rows()).rows[0]).toMatchObject({ uncounted_serves: 20, ignored_events: 40 });
    await expect(addGapCounts(db(), 'gap-1', { uncountedServes: -1 })).rejects.toThrow(/inteiros/);
    await expect(addGapCounts(db(), 'gap-1', { ignoredEvents: 1.5 })).rejects.toThrow(/inteiros/);
    expect(await addGapCounts(db(), 'gap-99', { uncountedServes: 1 })).toBe(false);
    expect(await addGapCounts(db(), 'gap-1', {})).toBe(true);
  });

  it('saveGap só alarga a janela e não toca nos contadores; regredido prevalece sobre perdido', async () => {
    const base = { id: 'gap-1', reason: 'dedupe_perdido' as const, from: '2026-11-24T10:00:00.000Z', servedUntil: '2026-11-24T10:30:00.000Z', to: '2026-11-24T12:00:00.000Z', detectedAt: '2026-11-24T10:00:00.000Z', uncountedServes: 0, ignoredEvents: 0 };
    await saveGap(db(), base);
    await addGapCounts(db(), 'gap-1', { uncountedServes: 5 });
    await saveGap(db(), { ...base, reason: 'dedupe_regrediu', from: '2026-11-24T09:00:00.000Z', to: '2026-11-24T11:00:00.000Z', uncountedServes: 0 }); // `to` menor: não encolhe
    const [g] = await loadGaps(db());
    expect(g).toMatchObject({ reason: 'dedupe_regrediu', from: '2026-11-24T09:00:00.000Z', to: '2026-11-24T12:00:00.000Z', uncountedServes: 5 });
    await saveGap(db(), { ...base, reason: 'dedupe_perdido' });
    expect((await loadGaps(db()))[0]!.reason).toBe('dedupe_regrediu');
  });

  it('writeWatermark: max nunca recua, set recua; recusa valor inválido', async () => {
    await writeWatermark(db(), 'x', 10, new Date(T0), 'max');
    await writeWatermark(db(), 'x', 4, new Date(T0 + 1), 'max');
    expect((await readWatermark(db(), 'x'))?.value).toBe(10);
    await writeWatermark(db(), 'x', 4, new Date(T0 + 2), 'set');
    expect((await readWatermark(db(), 'x'))?.value).toBe(4);
    await expect(writeWatermark(db(), 'x', -1, new Date(T0), 'set')).rejects.toThrow();
  });
});

describe('startAdRedisWatch e log', () => {
  it('bate na subida, não sobrepõe batidas, entrega o resultado, reporta erro do banco sem derrubar e para', async () => {
    const results: string[] = [];
    const errors: unknown[] = [];
    const w = startAdRedisWatch({ db: db(), redis, intervalMs: 3_600_000, now: at(0), onResult: (r) => results.push(r.state), onError: (e) => errors.push(e) });
    await vi.waitFor(() => expect(results).toEqual(['baseline']));
    await Promise.all([w.tick(), w.tick()]); // a segunda chamada é pulada se a primeira ainda corre
    expect(results.length).toBeGreaterThanOrEqual(2);
    w.stop();
    // erro do PostgreSQL: vai a onError, o processo segue
    const bad = { transaction: () => Promise.reject(new Error('pg fora')) } as unknown as Db;
    const e2: unknown[] = [];
    const w2 = startAdRedisWatch({ db: bad, redis, intervalMs: 3_600_000, onError: (e) => e2.push(e) });
    await vi.waitFor(() => expect(e2).toHaveLength(1));
    w2.stop();
    expect(errors).toEqual([]);
  });

  it('a linha de log traz só estado, motivo, id e horários', () => {
    const line = describeHeartbeat({ state: 'loss', reason: 'dedupe_perdido', cause: 'chave_ausente', value: 1, gap: { id: 'gap-1', reason: 'dedupe_perdido', from: 'A', servedUntil: 'B', to: 'C', detectedAt: 'D', uncountedServes: 0, ignoredEvents: 0 } });
    expect(line).toBe('perda do dedupe detectada: dedupe_perdido (chave_ausente); lacuna gap-1 de A até C');
    expect(describeHeartbeat({ state: 'unreachable', since: 'S' })).toContain('desde S');
  });
});

// o schema exportado continua sendo o das tabelas da migração 0011 (o monitor não cria tabela)
it('usa as tabelas da migração 0011', () => {
  expect(schema.adRedisWatermark).toBeDefined();
  expect(schema.adDeliveryGaps).toBeDefined();
});
