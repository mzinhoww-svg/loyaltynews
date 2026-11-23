/**
 * Lógica da carga por linha de comando (testável sem rede): lê o conjunto e o relatório de verificação, faz o dry-run e,
 * só com `apply: true`, carrega e grava o manifesto (para desfazer). O ponto de entrada fino está em scripts/load-seed.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Db } from './db';
import { loadSeed, planSeedLoad, type LoadManifest, type LoadPlan, type SeedDataset, type VerificationReport } from './seed-load';

export interface SeedCliOptions {
  datasetPath: string;
  verificationPath: string;
  /** false (padrão) = só dry-run. */
  apply?: boolean;
  /** Onde gravar o manifesto da carga (obrigatório com apply). */
  manifestPath?: string;
}

export interface SeedCliResult {
  mode: 'dry-run' | 'apply';
  plan: LoadPlan;
  manifest: LoadManifest | null;
}

export async function runSeedCli(db: Db, o: SeedCliOptions): Promise<SeedCliResult> {
  const ds = JSON.parse(readFileSync(o.datasetPath, 'utf8')) as SeedDataset;
  const ver = JSON.parse(readFileSync(o.verificationPath, 'utf8')) as VerificationReport;
  if (!o.apply) return { mode: 'dry-run', plan: await planSeedLoad(db, ds, ver), manifest: null };
  if (!o.manifestPath) throw new Error('manifestPath é obrigatório com apply (necessário para desfazer a carga)');
  const { plan, manifest } = await loadSeed(db, ds, ver);
  if (manifest) writeFileSync(o.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { mode: 'apply', plan, manifest };
}
