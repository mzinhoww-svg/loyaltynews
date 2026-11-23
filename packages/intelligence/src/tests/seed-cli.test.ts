import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { rollbackSeed, runSeedCli, type LoadManifest } from '../index';
import { newDb } from './helpers';

const data = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const opts = { datasetPath: data('seed.public.v1.json'), verificationPath: data('seed.public.v1.verification.json') };

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const orgs = async () => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.organization`)).rows[0]!.c);

describe('carga por linha de comando (lógica)', () => {
  it('padrão é dry-run: relata o plano e não escreve nada', async () => {
    const r = await runSeedCli(db, opts);
    expect(r).toMatchObject({ mode: 'dry-run', manifest: null, plan: { ok: true, counts: { create: 7, exists: 0, rejected: 0 } } });
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
      expect(await orgs()).toBe(5);
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as LoadManifest;
      expect(m.datasetId).toBe('seed.public.v1');
      expect(m.organizationsCreated).toHaveLength(5);
      await rollbackSeed(db, m);
      expect(await orgs()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
