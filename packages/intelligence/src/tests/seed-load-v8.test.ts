import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { checkSeedState, listRolesHandler, rereadSourcesFromSeed, runSeedCli, validateSeed, type SeedDataset, type VerificationReport } from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V7 = read<SeedDataset>('seed.public.v7.json');
const V8 = read<SeedDataset>('seed.public.v8.json');
const V8_VER = read<VerificationReport>('seed.public.v8.verification.json');
const ds = (v: number) => ({ datasetPath: file(`seed.public.v${v}.json`), verificationPath: file(`seed.public.v${v}.verification.json`) });

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

describe('seed.public.v8 (arquivos reais): cargo de fonte OFICIAL da ABEMF', () => {
  it('v7 intacta + 1 cargo oficial (Paulo Curro, diretor executivo da ABEMF); só nome, cargo e empresa; nada "a confirmar" virou fato', () => {
    expect(validateSeed(V8)).toEqual([]);
    expect(V8.organizations).toEqual(V7.organizations);
    expect(V8.relations).toEqual(V7.relations);
    expect(V8.roles!.slice(0, V7.roles!.length)).toEqual(V7.roles);
    const novo = V8.roles!.slice(V7.roles!.length);
    expect(novo).toHaveLength(1);
    expect(novo[0]).toMatchObject({ personName: 'Paulo Curro', orgKey: 'abemf', sourceLevel: 'oficial', quote: 'Paulo Curro é diretor executivo da ABEMF' });
    expect(Object.keys(novo[0]!).sort()).toEqual(['orgKey', 'personName', 'quote', 'sourceId', 'sourceLevel', 'title']);
    // os 7 cargos "a confirmar" continuam secundários (nenhum foi promovido por este conjunto)
    expect(V8.roles!.filter((r) => r.sourceLevel === 'secundaria')).toHaveLength(7);
    expect(V8.sources.find((s) => s.id === 'abemf-noticia2')!.url).toMatch(/^https:\/\/web\.abemf\.com\.br\//);
  });

  it('verificador 105/105 (29 + 36 + 40), 38 fontes verified; captura nova só com metadados no git; a releitura oficial passa a cobrir a ABEMF', () => {
    expect(V8_VER.datasetId).toBe('seed.public.v8');
    expect(V8_VER.records).toHaveLength(105);
    expect(V8_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(V8_VER.sources).toHaveLength(38);
    for (const s of V8_VER.sources) expect(s).toMatchObject({ status: 'verified', http_status: 200 });
    const meta = JSON.parse(readFileSync(file('captures/abemf-noticia2.meta.json'), 'utf8')) as Record<string, unknown>;
    expect(existsSync(file('captures/abemf-noticia2.meta.json'))).toBe(true);
    expect(meta).not.toHaveProperty('text');
    expect(meta.sha256Claimed).toBe(V8_VER.sources.find((s) => s.id === 'abemf-noticia2')!.content_sha256);
    expect(rereadSourcesFromSeed(V8).flatMap((s) => s.roles)).toHaveLength(33); // 32 (v5) + ABEMF; secundários nunca entram
  });
});

describe('carga da v8 sobre o staging (v2…v7), com os arquivos reais pelo caminho do carregador', () => {
  it('dry-run create 1 / exists 104; aplicar; estado final conferido; secundários seguem "a confirmar"; repetir = tudo existente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ln-v8-'));
    try {
      for (const v of [2, 3]) await runSeedCli(db, { ...ds(v), apply: true, manifestPath: join(dir, `v${v}.json`) });
      for (const v of [4, 5, 6, 7]) await runSeedCli(db, { ...ds(v), apply: true, withPersons: true, manifestPath: join(dir, `v${v}.json`) });
      expect(await checkSeedState(db)).toMatchObject({ persons: 39, role_assignments: 39, role_assignments_inferred: 7, evidence: 325, org_relations: 36 });

      const dry = await runSeedCli(db, { ...ds(8), withPersons: true });
      expect(dry.plan).toMatchObject({ ok: true, counts: { create: 1, exists: 104, rejected: 0 } });
      expect((await runSeedCli(db, { ...ds(8) })).plan.counts.rejected).toBe(40); // sem --with-persons os cargos são recusados

      const done = await runSeedCli(db, { ...ds(8), apply: true, withPersons: true, manifestPath: join(dir, 'v8.json') });
      expect(done.manifest!.rolesCreated).toHaveLength(1);
      expect(done.manifest!.personsCreated).toHaveLength(1);
      expect(await checkSeedState(db)).toMatchObject({
        organizations: 29, org_relations: 36, org_relations_not_declared: 0, persons: 40, role_assignments: 40, role_assignments_inferred: 7,
        role_assignments_without_evidence: 0, moves: 0, evidence: 401, evidence_mock: 0,
      });
      const q = ((await listRolesHandler(db, { q: 'paulo curro' })).body as { items: { status: string; source_level: string; organization: string }[] }).items;
      expect(q).toHaveLength(1);
      expect(q[0]).toMatchObject({ status: 'confirmed', source_level: 'official' });
      expect((await runSeedCli(db, { ...ds(8), withPersons: true })).plan.counts).toEqual({ create: 0, exists: 105, rejected: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
