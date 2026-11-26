import { afterAll, describe, expect, it } from 'vitest';
import { addEvidence, createWatchlist, ingestBatch, INGEST_SCHEMA_VERSION, listAlerts, reviewMove, upsertOrganization, watch, type Db as IntelDb } from '@ln/intelligence';
import { createTestDb } from '@ln/db/testing';
import { runAlertCycle, startIntelligenceAlerts } from './intelligence-alerts';
import { workerFlagResolver } from './worker-flags';

const quiet = () => undefined;

const T = '2026-11-01T00:00:00Z';
const ON = { personIngestion: true, extendedPersonalData: false } as const;
const FLAG = { APP_ENV: 'staging', LN_FLAGS_ON: 'intelligencePessoas' };
const db0 = { query: async () => ({ rows: [] }) } as unknown as IntelDb;

describe('job de alertas das watchlists: desligado por padrão (resolvedor único da ADR-022)', () => {
  it('sem a chave operacional ou sem a flag pelo resolvedor não liga; LN_INTELLIGENCE_PESSOAS ou LN_FLAGS_ON no env do job não ligam nada', () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    expect(startIntelligenceAlerts({ db: db0, env: {}, flags: workerFlagResolver(FLAG, quiet), log })).toBeNull();
    expect(startIntelligenceAlerts({ db: db0, env: { LN_INTELLIGENCE_ALERTS: 'on' }, log })).toBeNull();
    expect(startIntelligenceAlerts({ db: db0, env: { LN_INTELLIGENCE_ALERTS: 'on', LN_INTELLIGENCE_PESSOAS: 'on', ...FLAG }, log })).toBeNull();
    expect(startIntelligenceAlerts({ db: db0, env: { LN_INTELLIGENCE_ALERTS: 'on' }, flags: workerFlagResolver({ APP_ENV: 'staging' }, quiet), log })).toBeNull();
    expect(startIntelligenceAlerts({ db: db0, env: { LN_INTELLIGENCE_ALERTS: 'on' }, flags: workerFlagResolver({ APP_ENV: 'production' }, quiet), log })).toBeNull();
    expect(startIntelligenceAlerts({ db: db0, env: { LN_INTELLIGENCE_ALERTS: 'on' }, flags: () => { throw new Error('x'); }, log })).toBeNull();
    expect(lines.join(' | ')).toMatch(/flag intelligencePessoas desligada/);
  });

  it('com a chave e a flag pelo resolvedor (staging) liga (janela 30 d; piso de 5 min) e o stop cancela os timers', () => {
    const lines: string[] = [];
    const h = startIntelligenceAlerts({ db: db0, env: { LN_INTELLIGENCE_ALERTS: 'on', LN_ALERTS_INTERVAL_MIN: '1' }, flags: workerFlagResolver(FLAG, quiet), log: (l) => lines.push(l) });
    expect(h).not.toBeNull();
    h!.stop();
    expect(lines[0]).toBe('[intelligence-alerts] ligado: janela 30 d, a cada 5 min');
  });
});

describe('ciclo de alertas: só Move CONFIRMADO gera alerta, uma vez, só dentro da janela', () => {
  const closers: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const c of closers) await c();
  });

  it('detectado e rejeitado não geram; confirmado gera para a lista que observa a organização; repetir não duplica; fora da janela não gera', async () => {
    const t = await createTestDb();
    closers.push(t.close);
    const db = { query: async (sql: string, params?: unknown[]) => ({ rows: (await t.client.query(sql, params)).rows }) } as unknown as IntelDb;
    const alfa = await upsertOrganization(db, { legalName: 'Alfa S.A.', evidenceId: await addEvidence(db, { sourceUrl: 'https://ri.alfa.example.invalid/', sourceName: 'Alfa', retrievedAt: T, isMock: true }), observedAt: T });
    const wl = await createWatchlist(db, 'Alfa', 'user-1');
    await watch(db, wl, 'organization', alfa);
    const mk = (nome: string, de: string, para: string, at: string) => ({
      schemaVersion: INGEST_SCHEMA_VERSION,
      evidence: { sourceUrl: `https://ri.alfa.example.invalid/${nome.replace(/\s/g, '-')}-${at}`, sourceName: 'MOCK Alfa RI', retrievedAt: at, isMock: true },
      observations: [
        { personName: nome, orgName: 'Alfa S.A.', title: de, kind: 'present' as const, observedAt: '2026-10-01T00:00:00Z' },
        { personName: nome, orgName: 'Alfa S.A.', title: para, kind: 'present' as const, observedAt: at },
      ],
    });
    await ingestBatch(db, mk('MOCK Eva', 'Gerente', 'Diretora', '2026-11-10T00:00:00Z'), ON);
    await ingestBatch(db, mk('MOCK Caio', 'Analista', 'Gerente', '2026-11-11T00:00:00Z'), ON);
    const moves = (await db.query<{ id: string; person: string }>(`SELECT m.id, p.full_name AS person FROM intelligence.move m JOIN intelligence.person p ON p.id = m.person_id ORDER BY p.full_name`)).rows;
    const caio = moves.filter((m) => m.person === 'MOCK Caio').map((m) => m.id);
    const eva = moves.filter((m) => m.person === 'MOCK Eva').map((m) => m.id);
    expect(caio.length).toBeGreaterThan(0);
    expect(eva.length).toBeGreaterThan(0);
    const now = new Date();

    // nada confirmado: um Move apenas detectado não vira alerta
    expect(await runAlertCycle(db, { now })).toEqual({ moves: 0, created: 0 });
    expect(await listAlerts(db)).toEqual([]);

    // confirma os de Caio e rejeita os de Eva
    for (const id of caio) await reviewMove(db, id, 'confirmed');
    for (const id of eva) await reviewMove(db, id, 'rejected');
    const r1 = await runAlertCycle(db, { now });
    expect(r1.moves).toBe(caio.length);
    expect(r1.created).toBeGreaterThan(0);
    const alertas = await listAlerts(db);
    expect(alertas.length).toBe(r1.created);
    expect(new Set(alertas.map((a) => a.person_name))).toEqual(new Set(['MOCK Caio']));
    expect(alertas.every((a) => a.status === 'pending_review' && a.watchlist_id === wl)).toBe(true);

    // auditoria: uma linha por alerta, ator sistema, só ids
    const aud = (await t.client.query(`SELECT actor_id, actor_role, resource_id, detalhe FROM audit_log WHERE action = 'intelligence.alerta_gerado'`)).rows as Array<{ actor_id: string | null; actor_role: string; resource_id: string; detalhe: unknown }>;
    expect(aud.length).toBe(r1.created);
    expect(new Set(aud.map((x) => x.resource_id))).toEqual(new Set(alertas.map((a) => a.id)));
    expect(aud.every((x) => x.actor_id === null && x.actor_role === 'sistema')).toBe(true);
    expect(JSON.stringify(aud)).not.toContain('MOCK Caio');

    // idempotente (e sem auditoria nova)
    expect((await runAlertCycle(db, { now })).created).toBe(0);
    expect((await t.client.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'intelligence.alerta_gerado'`)).rows[0].n).toBe(r1.created);
    expect((await listAlerts(db)).length).toBe(alertas.length);

    // fora da janela: o Move detectado há mais de 30 dias não entra
    const longe = new Date(now.getTime() + 60 * 86_400_000);
    expect(await runAlertCycle(db, { now: longe, windowDays: 30 })).toEqual({ moves: 0, created: 0 });
  }, 120_000);
});
