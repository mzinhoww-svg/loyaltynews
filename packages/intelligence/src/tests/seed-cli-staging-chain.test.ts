import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { checkSeedState, runSeedCli } from '../index';
import { newDb } from './helpers';

// Ensaio do roteiro de carga com os ARQUIVOS REAIS e o caminho de produção do carregador (runSeedCli, o mesmo do load-seed.ts):
// reproduz a ordem do staging (v2 → v3 → v4 → v5 → v6) e confere os números que o STAGING_LOAD_PLAN.md promete para a v7.
const data = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const ds = (v: number) => ({ datasetPath: data(`seed.public.v${v}.json`), verificationPath: data(`seed.public.v${v}.verification.json`) });

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

describe('roteiro de carga: ensaio em PGlite com os arquivos reais (v2 → v7)', () => {
  it('a v7 sobre o staging (v2…v6 carregadas): dry-run create 9 / exists 95 com --with-persons; sem a flag os 39 cargos são recusados; aplicar e conferir o estado final do plano', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ln-chain-'));
    try {
      const apply = async (v: number, withPersons: boolean) => {
        const r = await runSeedCli(db, { ...ds(v), apply: true, withPersons, manifestPath: join(dir, `v${v}.manifest.json`) });
        expect(r.plan.counts.rejected, `v${v}`).toBe(0);
        return r;
      };
      await apply(2, false);
      await apply(3, false);
      await apply(4, true);
      await apply(5, true);
      await apply(6, true);
      // estado que o plano diz ter antes da v7
      expect(await checkSeedState(db)).toMatchObject({ organizations: 29, persons: 39, role_assignments: 39, role_assignments_inferred: 7, org_relations: 28, org_relations_not_declared: 1, evidence: 250, moves: 0 });

      // DRY-RUN com --with-persons (só leitura)
      const dry = await runSeedCli(db, { ...ds(7), withPersons: true });
      expect(dry).toMatchObject({ mode: 'dry-run', manifest: null, plan: { ok: true, counts: { create: 9, exists: 95, rejected: 0 } } });
      expect(await checkSeedState(db)).toMatchObject({ evidence: 250, org_relations: 28 }); // nada escrito
      // sem --with-persons: a proteção recusa os cargos (o carregador sai com exit 1)
      const noFlag = await runSeedCli(db, { ...ds(7) });
      expect(noFlag.plan.counts.rejected).toBe(39);

      // APLICAR e conferir o "estado depois" do roteiro
      const done = await apply(7, true);
      expect(done.manifest!.relationsCreated).toHaveLength(8);
      expect(done.manifest!.relationsStaleRestored).toHaveLength(1);
      expect(await checkSeedState(db)).toMatchObject({
        organizations: 29, org_relations: 36, org_relations_not_declared: 0, persons: 39, role_assignments: 39, role_assignments_inferred: 7,
        role_assignments_without_evidence: 0, moves: 0, evidence: 325, evidence_mock: 0, extended_personal_data_enabled: false,
      });
      // idempotente: repetir mostra tudo como existente
      const again = await runSeedCli(db, { ...ds(7), withPersons: true });
      expect(again.plan.counts).toEqual({ create: 0, exists: 104, rejected: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
