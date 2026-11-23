import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { checkSeedState, rollbackSeed, runSeedCli, type LoadManifest } from '../index';
import { newDb } from './helpers';

const data = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const opts = { datasetPath: data('seed.public.v2.json'), verificationPath: data('seed.public.v2.verification.json') };

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const orgs = async () => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.organization`)).rows[0]!.c);

describe('carga por linha de comando (lógica)', () => {
  it('padrão é dry-run: relata o plano e não escreve nada', async () => {
    const r = await runSeedCli(db, opts);
    expect(r).toMatchObject({ mode: 'dry-run', manifest: null, plan: { ok: true, counts: { create: 40, exists: 0, rejected: 0 } } });
    expect(await orgs()).toBe(0);
  });

  it('apply exige caminho do manifesto; com ele carrega e grava o manifesto que desfaz a carga', async () => {
    await expect(runSeedCli(db, { ...opts, apply: true })).rejects.toThrow(/manifestPath/);
    expect(await orgs()).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), 'ln-seed-'));
    try {
      const manifestPath = join(dir, 'manifest.json');
      const r = await runSeedCli(db, { ...opts, apply: true, manifestPath });
      expect(r.mode).toBe('apply');
      expect(await orgs()).toBe(20);
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as LoadManifest;
      expect(m.datasetId).toBe('seed.public.v2');
      expect(m.organizationsCreated).toHaveLength(20);
      await rollbackSeed(db, m);
      expect(await orgs()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pré-checagem do schema', () => {
  it('sem o schema intelligence a carga para com mensagem clara (e nada é escrito)', async () => {
    const empty = {
      query: async (sql: string, params?: unknown[]) => (sql.includes('to_regclass') ? { rows: [{ t: null, k: null }] } : db.query(sql, params)),
    } as Db;
    await expect(runSeedCli(empty, opts)).rejects.toThrow(/schema_intelligence_ausente/);
    await expect(runSeedCli(empty, { ...opts, apply: true, manifestPath: 'x.json' })).rejects.toThrow(/schema_intelligence_ausente/);
    expect(await orgs()).toBe(0);
  });
});

describe('conferência de estado (--check)', () => {
  it('antes: tudo zero e flag ampliada desligada; depois da carga: 20/20, nenhuma relação não declarada, sem pessoas, cargos ou Moves', async () => {
    expect(await checkSeedState(db)).toEqual({
      organizations: 0, org_relations: 0, org_relations_not_declared: 0, evidence: 0, evidence_mock: 0, persons: 0, role_assignments: 0, moves: 0,
      suppression_tombstones: 0, extended_personal_data_enabled: false,
    });
    const dir = mkdtempSync(join(tmpdir(), 'ln-seed-'));
    try {
      await runSeedCli(db, { ...opts, apply: true, manifestPath: join(dir, 'm.json') });
      expect(await checkSeedState(db)).toMatchObject({
        organizations: 20, org_relations: 20, org_relations_not_declared: 0, evidence_mock: 0, persons: 0, role_assignments: 0, moves: 0, extended_personal_data_enabled: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
