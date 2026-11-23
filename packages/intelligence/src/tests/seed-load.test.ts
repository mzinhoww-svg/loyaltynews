import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import {
  createWatchlist, loadSeed, neighbors, planSeedLoad, rollbackSeed, validateSeed, watch,
  type SeedDataset, type VerificationReport,
} from '../index';
import { newDb } from './helpers';

const dataFile = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const REAL: SeedDataset = JSON.parse(readFileSync(dataFile('seed.public.v1.json'), 'utf8'));
const REAL_VER: VerificationReport = JSON.parse(readFileSync(dataFile('seed.public.v1.verification.json'), 'utf8'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);

describe('conjunto de dados verificado seed.public.v1 (arquivos reais do repositório)', () => {
  it('estrutura válida, sem pessoas, e todos os registros com citação literal encontrada', () => {
    expect(validateSeed(REAL)).toEqual([]);
    expect(REAL.persons).toEqual([]);
    expect(REAL_VER.datasetId).toBe(REAL.datasetId);
    expect(REAL_VER.records).toHaveLength(REAL.organizations.length + REAL.relations.length);
    expect(REAL_VER.records.every((r) => r.quote_found)).toBe(true);
    for (const s of REAL_VER.sources) {
      expect(s).toMatchObject({ status: 'verified', http_status: 200 });
      expect(s.content_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Date.parse(s.fetched_at!)).not.toBeNaN();
    }
    // nenhuma relação inferida/presumida: o formato nem tem campo para isso
    expect(REAL.relations.every((r) => Object.keys(r).sort().join() === 'from,quote,sourceId,to,type')).toBe(true);
  });
});

describe('plano (dry-run) e carga', () => {
  it('dry-run não escreve; carga cria organizações e relações com evidência e data de validação', async () => {
    const plan = await planSeedLoad(db, REAL, REAL_VER);
    expect(plan).toMatchObject({ ok: true, counts: { create: 7, exists: 0, rejected: 0 } });
    expect(await count('organization')).toBe(0);
    expect(await count('evidence')).toBe(0);

    const { manifest } = await loadSeed(db, REAL, REAL_VER);
    expect(manifest!.organizationsCreated).toHaveLength(5);
    expect(manifest!.relationsCreated).toHaveLength(2);
    expect(await count('organization')).toBe(5);
    expect(await count('org_relation')).toBe(2);
    expect([await count('person'), await count('role_assignment'), await count('move'), await count('org_chart_edge')]).toEqual([0, 0, 0, 0]);

    const rel = await db.query<{ certainty: string; valid_from: string; validated_at: string; observed_at: string; source_url: string; retrieved_at: string; content_hash: string; excerpt: string; is_mock: boolean; source_class: string }>(
      `SELECT x.certainty, x.valid_from::text, x.validated_at, x.observed_at, e.source_url, e.retrieved_at, e.content_hash, e.excerpt, e.is_mock, e.source_class
         FROM intelligence.org_relation x JOIN intelligence.evidence e ON e.id = x.evidence_id`,
    );
    expect(rel.rows).toHaveLength(2);
    for (const r of rel.rows) {
      expect(r.certainty).toBe('declared');
      expect(r.source_class).toBe('public');
      expect(r.is_mock).toBe(false);
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(r.excerpt.length).toBeGreaterThanOrEqual(20);
      expect(new Date(r.validated_at).toISOString()).toBe(new Date(r.retrieved_at).toISOString());
      expect(r.valid_from).toBe(new Date(r.retrieved_at).toISOString().slice(0, 10)); // vigência = data da verificação, não data inventada do fato
    }
    // o grafo enxerga as relações
    const bradesco = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE normalized_name = 'bradesco'`)).rows[0]!.id;
    const n = await neighbors(db, { type: 'organization', id: bradesco }, { asOf: new Date().toISOString().slice(0, 10) });
    expect(n.filter((x) => x.depth === 1)).toHaveLength(1);
  });

  it('idempotente: segunda carga não duplica, só renova a validação das relações', async () => {
    await loadSeed(db, REAL, REAL_VER);
    const ver2 = clone(REAL_VER);
    for (const s of ver2.sources) s.fetched_at = '2099-01-01T00:00:00.000Z';
    const plan = await planSeedLoad(db, REAL, ver2);
    expect(plan.counts).toEqual({ create: 0, exists: 7, rejected: 0 });
    const { manifest } = await loadSeed(db, REAL, ver2);
    expect(manifest!.organizationsCreated).toEqual([]);
    expect(manifest!.relationsCreated).toEqual([]);
    expect(manifest!.relationsRevalidated).toHaveLength(2);
    expect([await count('organization'), await count('org_relation')]).toEqual([5, 2]);
    const v = await db.query<{ validated_at: string }>(`SELECT validated_at FROM intelligence.org_relation`);
    expect(v.rows.every((r) => new Date(r.validated_at).getUTCFullYear() === 2099)).toBe(true);
  });
});

describe('recusas: nada entra sem verificação', () => {
  it('sem relatório, relatório de outro conjunto ou estrutura inválida: nada é carregado', async () => {
    expect((await loadSeed(db, REAL, null)).manifest).toBeNull();
    expect((await planSeedLoad(db, REAL, { ...REAL_VER, datasetId: 'outro' })).issues).toContain('relatório de verificação é de outro conjunto');
    const bad = clone(REAL);
    bad.persons = [{ key: 'x' }];
    expect((await planSeedLoad(db, bad, REAL_VER)).issues.join()).toMatch(/persons: não suportado/);
    const withCertainty = clone(REAL) as unknown as { relations: Record<string, unknown>[] };
    withCertainty.relations[0]!.certainty = 'inferred';
    expect(validateSeed(withCertainty).join()).toMatch(/não permitido/);
    expect(await count('organization')).toBe(0);
    expect(await count('evidence')).toBe(0);
  });

  it('citação não encontrada recusa o registro e as relações que dependem dele; os demais entram', async () => {
    const ver = clone(REAL_VER);
    ver.records.find((r) => r.ref === 'organization:livelo')!.quote_found = false;
    const { plan, manifest } = await loadSeed(db, REAL, ver);
    expect(plan.records.find((r) => r.ref === 'organization:livelo')).toMatchObject({ action: 'rejected', reason: 'citação literal não encontrada na página da fonte' });
    expect(plan.records.find((r) => r.ref === 'relation:bradesco>other>livelo')).toMatchObject({ action: 'rejected', reason: 'organização da relação foi recusada' });
    expect(plan.counts).toEqual({ create: 5, exists: 0, rejected: 2 });
    expect(manifest!.organizationsCreated).toHaveLength(4);
    expect(manifest!.relationsCreated).toHaveLength(1);
    expect(await count('organization')).toBe(4);
  });

  it('fonte que não respondeu 200 ou com URL diferente da verificada é recusada', async () => {
    const ver = clone(REAL_VER);
    ver.sources.find((s) => s.id === 'abemf-home')!.http_status = 404;
    ver.sources.find((s) => s.id === 'latampass-conheca')!.url = 'https://outro.invalid/x';
    const plan = await planSeedLoad(db, REAL, ver);
    const why = Object.fromEntries(plan.records.filter((r) => r.action === 'rejected').map((r) => [r.ref, r.reason]));
    expect(why['organization:abemf']).toBe('fonte não buscada com sucesso na verificação');
    expect(why['organization:latam-pass']).toBe('URL da fonte diferente da verificada');
    expect(why['relation:latam>other>latam-pass']).toBeTruthy();
    expect(plan.counts.rejected).toBe(4); // abemf, latam, latam-pass e a relação entre os dois
  });

  it('registro ausente do relatório é recusado', async () => {
    const ver = clone(REAL_VER);
    ver.records = ver.records.filter((r) => r.ref !== 'organization:abemf');
    expect((await planSeedLoad(db, REAL, ver)).records.find((r) => r.ref === 'organization:abemf')!.reason).toBe('registro ausente no relatório de verificação');
  });
});

describe('transação e desfazer', () => {
  it('falha no meio da carga desfaz tudo (nada pela metade)', async () => {
    const failing: Db = {
      query: (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO intelligence.org_relation')) return Promise.reject(new Error('falha simulada'));
        return db.query(sql, params);
      },
    } as Db;
    await expect(loadSeed(failing, REAL, REAL_VER)).rejects.toThrow('falha simulada');
    expect([await count('organization'), await count('evidence'), await count('org_relation')]).toEqual([0, 0, 0]);
  });

  it('rollbackSeed remove o que a carga criou; organização já referenciada por outra coisa é mantida', async () => {
    const { manifest } = await loadSeed(db, REAL, REAL_VER);
    const livelo = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE normalized_name = 'livelo'`)).rows[0]!.id;
    await watch(db, await createWatchlist(db, 'MOCK', 'mock-owner'), 'organization', livelo);
    const r = await rollbackSeed(db, manifest!);
    expect(r).toMatchObject({ relationsRemoved: 2, organizationsRemoved: 4, organizationsKept: 1 });
    expect(await count('org_relation')).toBe(0);
    expect(await count('organization')).toBe(1);
    expect(r.evidenceRemoved).toBeGreaterThan(0);
    // a evidência da organização mantida continua (ainda referenciada)
    const ev = await db.query(`SELECT 1 FROM intelligence.evidence e JOIN intelligence.organization o ON o.evidence_id = e.id`);
    expect(ev.rows).toHaveLength(1);
  });
});
