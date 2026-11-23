/**
 * Lógica da carga por linha de comando (testável sem rede): lê o conjunto e o relatório de verificação, faz o dry-run e,
 * só com `apply: true`, carrega e grava o manifesto (para desfazer). O ponto de entrada fino está em scripts/load-seed.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Db } from './db';
import { DEFAULT_CONFIG, type IntelligenceConfig } from './config';
import { loadSeed, planSeedLoad, type LoadManifest, type LoadPlan, type SeedDataset, type VerificationReport } from './seed-load';

export interface SeedCliOptions {
  datasetPath: string;
  verificationPath: string;
  /** false (padrão) = só dry-run. */
  apply?: boolean;
  /** Onde gravar o manifesto da carga (obrigatório com apply). */
  manifestPath?: string;
  /** true = liga a ingestão de pessoas SÓ nesta execução (cargos públicos de intelligence-seed/2; J-01 exige decisão registrada). Padrão: desligada. */
  withPersons?: boolean;
}

export interface SeedCliResult {
  mode: 'dry-run' | 'apply';
  plan: LoadPlan;
  manifest: LoadManifest | null;
}

/** O schema `intelligence` precisa existir (migração 0006 do @ln/db, aplicada pelo DevOps). Mensagem sem dados de conexão. */
async function preflight(db: Db): Promise<void> {
  const r = await db.query<{ t: string | null; k: string | null }>(
    `SELECT to_regclass('intelligence.organization')::text AS t, to_regclass('intelligence.suppression_tombstone')::text AS k`,
  );
  if (!r.rows[0]?.t || !r.rows[0]?.k) throw new Error('schema_intelligence_ausente: aplique as migrações do @ln/db (0006_intelligence) antes da carga');
}

/** Conferência só de leitura do estado do schema (sem dados pessoais, sem nomes): contagens e invariantes que a carga promete. */
export async function checkSeedState(db: Db) {
  await preflight(db);
  const q = async (sql: string) => Number((await db.query<{ c: string }>(sql)).rows[0]!.c);
  return {
    organizations: await q(`SELECT count(*)::text c FROM intelligence.organization`),
    org_relations: await q(`SELECT count(*)::text c FROM intelligence.org_relation`),
    org_relations_not_declared: await q(`SELECT count(*)::text c FROM intelligence.org_relation WHERE certainty <> 'declared'`),
    evidence: await q(`SELECT count(*)::text c FROM intelligence.evidence`),
    evidence_mock: await q(`SELECT count(*)::text c FROM intelligence.evidence WHERE is_mock`),
    persons: await q(`SELECT count(*)::text c FROM intelligence.person`),
    persons_suppressed: await q(`SELECT count(*)::text c FROM intelligence.person WHERE suppressed_at IS NOT NULL`),
    role_assignments_inferred: await q(`SELECT count(*)::text c FROM intelligence.role_assignment WHERE certainty <> 'declared'`),
    role_assignments_without_evidence: await q(`SELECT count(*)::text c FROM intelligence.role_assignment WHERE evidence_id IS NULL OR validated_at IS NULL`),
    role_assignments: await q(`SELECT count(*)::text c FROM intelligence.role_assignment`),
    moves: await q(`SELECT count(*)::text c FROM intelligence.move`),
    suppression_tombstones: await q(`SELECT count(*)::text c FROM intelligence.suppression_tombstone`),
    extended_personal_data_enabled: (await db.query<{ v: boolean }>(`SELECT bool_value v FROM intelligence.intel_settings WHERE key = 'extended_personal_data'`)).rows[0]?.v ?? null,
  };
}

export async function runSeedCli(db: Db, o: SeedCliOptions): Promise<SeedCliResult> {
  await preflight(db);
  const ds = JSON.parse(readFileSync(o.datasetPath, 'utf8')) as SeedDataset;
  const ver = JSON.parse(readFileSync(o.verificationPath, 'utf8')) as VerificationReport;
  const cfg: IntelligenceConfig = o.withPersons ? { ...DEFAULT_CONFIG, personIngestion: true } : DEFAULT_CONFIG;
  if (!o.apply) return { mode: 'dry-run', plan: await planSeedLoad(db, ds, ver, cfg), manifest: null };
  if (!o.manifestPath) throw new Error('manifestPath é obrigatório com apply (necessário para desfazer a carga)');
  const { plan, manifest } = await loadSeed(db, ds, ver, cfg);
  if (manifest) writeFileSync(o.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { mode: 'apply', plan, manifest };
}
