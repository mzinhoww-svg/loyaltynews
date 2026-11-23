import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { loadSeed, planSeedLoad, rollbackSeed, validateSeed, type SeedDataset, type VerificationReport } from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V4 = read<SeedDataset>('seed.public.v4.json');
const V4_VER = read<VerificationReport>('seed.public.v4.verification.json');
const V5 = read<SeedDataset>('seed.public.v5.json');
const V5_VER = read<VerificationReport>('seed.public.v5.verification.json');
const ON = { personIngestion: true, extendedPersonalData: false };

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);

describe('seed.public.v5 (arquivos reais)', () => {
  it('v4 + 12 cargos de 7 organizações (32 cargos em 17); só campos permitidos; todos oficiais; sem fonte secundária', () => {
    expect(validateSeed(V5)).toEqual([]);
    expect(V5.roles).toHaveLength(32);
    expect(new Set(V5.roles!.map((r) => r.orgKey)).size).toBe(17);
    expect(V5.roles!.slice(0, 20)).toEqual(V4.roles);
    for (const r of V5.roles!) {
      expect(r.sourceLevel).toBe('oficial');
      expect(V5.sources.find((s) => s.id === r.sourceId)!.url).not.toMatch(/linkedin|theorg/i);
    }
    expect(JSON.stringify(V5.roles)).not.toMatch(/@|https?:|\+\d|\(\d{2}\)/);
    // Azul e Smiles (classe C da DP-28) nunca são fonte de cargo
    expect(V5.sources.some((s) => /voeazul|smiles|gol\./i.test(s.url) && V5.roles!.some((r) => r.sourceId === s.id))).toBe(false);
    expect(V5.roles!.some((r) => ['azul', 'smiles'].includes(r.orgKey))).toBe(false);
  });

  it('Santander→Esfera saiu: a fonte mudou (título da Esfera deixou de afirmar); nenhum registro sem fonte', () => {
    expect(V5.organizations.some((o) => o.key === 'santander')).toBe(false);
    expect(V5.relations.some((r) => r.from === 'santander' || r.to === 'santander')).toBe(false);
    expect(V5.sources.some((s) => s.id === 'esfera-site')).toBe(false);
    expect(V5.organizations).toHaveLength(28);
    expect(V5.relations).toHaveLength(27);
    for (const o of V5.organizations) expect(V5.sources.some((s) => s.id === o.sourceId)).toBe(true);
  });

  it('verificador: 87/87 (28 + 27 + 32), 24 fontes verified; capturas novas com metadados (sem texto) no git', () => {
    expect(V5_VER.datasetId).toBe('seed.public.v5');
    expect(V5_VER.records).toHaveLength(87);
    expect(V5_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(V5_VER.sources).toHaveLength(24);
    for (const s of V5_VER.sources) expect(s).toMatchObject({ status: 'verified', http_status: 200 });
    for (const r of V5.roles!) {
      const src = V5.sources.find((s) => s.id === r.sourceId)!;
      expect(src.method).toBe('capture');
      const metaPath = file(`captures/${r.sourceId}.meta.json`);
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
      expect(meta).not.toHaveProperty('text');
      expect(meta.sha256Claimed).toBe(V5_VER.sources.find((s) => s.id === r.sourceId)!.content_sha256);
    }
  });
});

describe('carga do v5 sobre o v4 (como seria no staging)', () => {
  it('cria só o que é novo: 12 cargos; os 76 registros do v4 já existentes (menos Santander→Esfera, que fica como está); desfazer deixa o v4 intacto', async () => {
    await loadSeed(db, V4, V4_VER, ON);
    const antes = { p: await count('person'), r: await count('role_assignment'), o: await count('organization'), rel: await count('org_relation'), ev: await count('evidence') };
    const plan = await planSeedLoad(db, V5, V5_VER, ON);
    expect(plan.counts).toEqual({ create: 12, exists: 75, rejected: 0 }); // 28 orgs + 27 relações + 20 cargos existentes; 12 cargos novos
    const { manifest } = await loadSeed(db, V5, V5_VER, ON);
    expect(manifest!.rolesCreated).toHaveLength(12);
    expect(manifest!.personsCreated).toHaveLength(12);
    expect(await count('evidence')).toBe(antes.ev + 27 + 20 + 12); // 27 relações e 20 cargos revalidados + 12 cargos novos
    expect([await count('person'), await count('role_assignment')]).toEqual([32, 32]);
    // Santander→Esfera (do v3) permanece com a validação antiga: o v5 não a renova nem a apaga
    expect(await count('org_relation')).toBe(antes.rel);
    await rollbackSeed(db, manifest!);
    expect({ p: await count('person'), r: await count('role_assignment'), o: await count('organization'), rel: await count('org_relation'), ev: await count('evidence') }).toEqual(antes);
  });

  it('sem a flag de pessoas o plano do v5 recusa os 32 cargos (exit 1 no carregador)', async () => {
    const plan = await planSeedLoad(db, V5, V5_VER);
    expect(plan.counts.rejected).toBe(32);
    expect(plan.records.filter((r) => r.action === 'rejected').every((r) => /ingestão de pessoas desligada/.test(r.reason!))).toBe(true);
  });
});
