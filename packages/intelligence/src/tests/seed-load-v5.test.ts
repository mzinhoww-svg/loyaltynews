import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { getCompanyHandler, loadSeed, planSeedLoad, portalCompanyPage, rollbackSeed, validateSeed, type SeedDataset, type VerificationReport } from '../index';
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
    expect(plan.counts).toEqual({ create: 13, exists: 75, rejected: 0 }); // 28 orgs + 27 relações + 20 cargos existentes; 12 cargos novos + 1 relação marcada "validação vencida"
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

  it('Santander→Esfera: marcada "validação vencida" (não apagada), fora do portal; o Studio vê o rótulo; nova fonte confirma; desfazer restaura', async () => {
    await loadSeed(db, V4, V4_VER, ON); // staging: a relação do v3 está declarada
    const oid = async (n: string) => (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE legal_name = $1`, [n])).rows[0]!.id;
    const esfera = await oid('Esfera');
    const rel = async () => (await db.query<{ id: string; certainty: string; inference_basis: string | null; valid_to: string | null }>(
      `SELECT id, certainty, inference_basis, valid_to::text FROM intelligence.org_relation x WHERE to_org_id = $1 ORDER BY valid_from, id`, [esfera])).rows;
    expect((await rel()).map((r) => r.certainty)).toContain('declared');
    const before = JSON.stringify(await rel());
    expect(validateSeed(V5)).toEqual([]);
    const { manifest } = await loadSeed(db, V5, V5_VER, ON);
    expect(manifest!.relationsExpiredPrevious).toHaveLength(1);
    const after = await rel();
    expect(after).toHaveLength(JSON.parse(before).length); // nada apagado
    const marked = after.find((r) => r.inference_basis?.startsWith('validação vencida em 2026-11-23'))!;
    expect(marked.certainty).toBe('inferred');
    // portal: a relação some; Studio: aparece rotulada
    const pub = JSON.stringify(await portalCompanyPage(db, esfera, '2027-01-01'));
    expect(pub).not.toContain('Santander');
    const studio = (await getCompanyHandler(db, 'studio', { id: esfera, asOf: '2027-01-01', includeInferred: true })).body as { relations: { other_org_name: string; certainty: string; stale_validation: boolean }[] };
    expect(studio.relations.find((r) => r.other_org_name === 'Santander')).toMatchObject({ certainty: 'inferred', stale_validation: true });
    // idempotente: o plano seguinte reconhece como já marcada
    expect((await planSeedLoad(db, V5, V5_VER, ON)).records.find((r) => r.ref.startsWith('expired:'))).toMatchObject({ action: 'exists' });
    // nova fonte verificada confirma: a relação volta a declarada, com a evidência nova
    const NEW: SeedDataset = {
      schemaVersion: 'intelligence-seed/2', datasetId: 'seed.teste.confirma',
      sources: [{ id: 'novo', name: 'MOCK nova fonte', url: 'https://mock.invalid/esfera-santander', method: 'capture' }],
      organizations: [{ key: 'a', legalName: 'Santander', kind: 'other', sourceId: 'novo', quote: 'MOCK Santander é a controladora' }, { key: 'b', legalName: 'Esfera', kind: 'other', sourceId: 'novo', quote: 'MOCK Esfera é do Santander' }],
      relations: [{ from: 'a', to: 'b', type: 'other', sourceId: 'novo', quote: 'MOCK Esfera é um programa do Santander' }],
    };
    const NEW_VER: VerificationReport = {
      datasetId: NEW.datasetId, verifiedAt: '2027-01-10T12:00:00Z',
      sources: [{ id: 'novo', url: NEW.sources[0]!.url, status: 'verified', http_status: 200, fetched_at: '2027-01-10T12:00:00Z', content_sha256: 'b'.repeat(64) }],
      records: [{ ref: 'organization:a', source_id: 'novo', quote_found: true }, { ref: 'organization:b', source_id: 'novo', quote_found: true }, { ref: 'relation:a>other>b', source_id: 'novo', quote_found: true }],
    };
    const conf = await loadSeed(db, NEW, NEW_VER, ON);
    expect(conf.manifest!.relationsStaleRestored).toHaveLength(1);
    const fin = await rel();
    expect(fin).toHaveLength(after.length); // a MESMA relação volta a declarada (sem linha nova, sem apagar)
    expect(fin.find((r) => r.id === marked.id)).toMatchObject({ certainty: 'declared', inference_basis: null, valid_to: null });
    expect(JSON.stringify(await portalCompanyPage(db, esfera, '2027-01-11'))).toContain('Santander');
    // desfazer a confirmação devolve o estado "validação vencida"; desfazer o v5 devolve a declarada original
    await rollbackSeed(db, conf.manifest!);
    expect((await rel()).find((r) => r.id === marked.id)).toMatchObject({ certainty: 'inferred', valid_to: null });
    await rollbackSeed(db, manifest!);
    expect(JSON.stringify(await rel())).toBe(before);
  });

  it('sem a flag de pessoas o plano do v5 recusa os 32 cargos (exit 1 no carregador)', async () => {
    const plan = await planSeedLoad(db, V5, V5_VER);
    expect(plan.counts.rejected).toBe(32);
    expect(plan.records.filter((r) => r.action === 'rejected').every((r) => /ingestão de pessoas desligada/.test(r.reason!))).toBe(true);
  });
});
