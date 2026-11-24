import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { getCompanyHandler, listRolesHandler, loadSeed, planSeedLoad, portalCompanyPage, rollbackSeed, validateSeed, type SeedDataset, type VerificationReport } from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V3 = read<SeedDataset>('seed.public.v3.json');
const V3_VER = read<VerificationReport>('seed.public.v3.verification.json');
const V5 = read<SeedDataset>('seed.public.v5.json');
const V5_VER = read<VerificationReport>('seed.public.v5.verification.json');
const V6 = read<SeedDataset>('seed.public.v6.json');
const V6_VER = read<VerificationReport>('seed.public.v6.verification.json');
const V7 = read<SeedDataset>('seed.public.v7.json');
const V7_VER = read<VerificationReport>('seed.public.v7.verification.json');
const ON = { personIngestion: true, extendedPersonalData: false };
const NEW_REL = V7.relations.slice(V6.relations.length);

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);
const orgId = async (n: string) => (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE legal_name = $1`, [n])).rows[0]!.id;

describe('seed.public.v7 (arquivos reais): relações de fontes oficiais', () => {
  it('v6 intacta + 9 relações + a organização Santander; só fontes oficiais; sem LinkedIn/The Org; sem marcação de vencida', () => {
    expect(validateSeed(V7)).toEqual([]);
    expect(V7.relations.slice(0, V6.relations.length)).toEqual(V6.relations);
    expect(NEW_REL).toHaveLength(9);
    expect(V7.organizations).toHaveLength(29);
    expect(V7.organizations.slice(0, 28)).toEqual(V6.organizations);
    expect(V7.expiredRelations).toBeUndefined(); // a Santander→Esfera voltou declarada por nova fonte oficial
    for (const r of NEW_REL) {
      const src = V7.sources.find((s) => s.id === r.sourceId)!;
      expect(src.url).not.toMatch(/linkedin|theorg/i);
      expect(['partner_of', 'other']).toContain(r.type);
      expect(Object.keys(r).every((k) => ['from', 'to', 'type', 'sourceId', 'quote', 'contextQuote'].includes(k))).toBe(true); // sem certeza/inferência no formato
    }
    // controle societário: só o que a página afirma (BB é acionista do BV; "criada por BB e Bradesco"); nenhum parent_of presumido
    expect(V7.relations.filter((r) => r.type === 'parent_of').length).toBe(V6.relations.filter((r) => r.type === 'parent_of').length);
    // Azul e Smiles (classe C): nenhuma relação nova
    expect(NEW_REL.some((r) => ['azul', 'smiles'].includes(r.from) || ['azul', 'smiles'].includes(r.to))).toBe(false);
  });

  it('a citação do Eros Canedo não traz mais o rótulo "Collapse" da página (cargo curto agora aceito: nome + cargo literais)', () => {
    const eros = V7.roles!.find((r) => r.personName === 'Eros Canedo')!;
    expect(eros.quote).toBe('Eros Canedo CFO');
    expect(JSON.stringify(V7.roles)).not.toMatch(/Collapse/);
    expect(validateSeed({ ...V7, roles: V7.roles!.map((r) => (r === eros ? { ...r, quote: 'CFO' } : r)) }).join(' ')).toMatch(/12 a 300/);
  });

  it('verificador 104/104 (29 + 36 + 39) e 37 fontes verified; capturas novas só com metadados no git', () => {
    expect(V7_VER.datasetId).toBe('seed.public.v7');
    expect(V7_VER.records).toHaveLength(104);
    expect(V7_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(V7_VER.sources).toHaveLength(37);
    for (const s of V7_VER.sources) expect(s).toMatchObject({ status: 'verified', http_status: 200 });
    for (const r of NEW_REL) {
      const metaPath = file(`captures/${r.sourceId}.meta.json`);
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
      expect(meta).not.toHaveProperty('text');
      expect(meta.sha256Claimed).toBe(V7_VER.sources.find((s) => s.id === r.sourceId)!.content_sha256);
    }
  });
});

describe('carga do v7 sobre o que está no staging (v3, v5 e v6)', () => {
  async function staging() {
    await loadSeed(db, V3, V3_VER);
    await loadSeed(db, V5, V5_VER, ON); // marca a Santander→Esfera como "validação vencida"
    await loadSeed(db, V6, V6_VER, ON);
  }

  it('cria as 9 relações, confirma a Santander→Esfera (a mesma relação volta a declarada) e limpa a evidência do Eros Canedo; desfazer restaura', async () => {
    await staging();
    const esfera = await orgId('Esfera');
    const relRows = async () => (await db.query<{ id: string; certainty: string; valid_to: string | null; inference_basis: string | null }>(
      `SELECT id, certainty, valid_to::text, inference_basis FROM intelligence.org_relation WHERE to_org_id = $1 AND relation_type = 'other' ORDER BY valid_from, id`, [esfera])).rows;
    const before = JSON.stringify(await relRows());
    expect((await relRows()).some((r) => r.inference_basis?.startsWith('validação vencida'))).toBe(true);
    const plan = await planSeedLoad(db, V7, V7_VER, ON);
    expect(plan.counts).toEqual({ create: 9, exists: 29 + 27 + 39, rejected: 0 });
    const ev0 = await count('evidence');
    const { manifest } = await loadSeed(db, V7, V7_VER, ON);
    expect(manifest!.relationsCreated).toHaveLength(8); // 9 relações novas no conjunto: 8 criadas + a Santander→Esfera, que volta declarada
    expect(manifest!.relationsStaleRestored).toHaveLength(1);
    expect(await count('evidence')).toBe(ev0 + 9 + 27 + 39); // novas + relações e cargos revalidados
    // Santander→Esfera: a MESMA relação volta a declarada (sem linha nova) e fica visível no portal
    const rows = await relRows();
    expect(rows).toHaveLength(JSON.parse(before).length);
    expect(rows.filter((r) => r.certainty === 'declared' && r.valid_to === null && r.inference_basis === null)).toHaveLength(1);
    expect(rows.some((r) => r.inference_basis?.startsWith('validação vencida'))).toBe(false);
    expect(JSON.stringify(await portalCompanyPage(db, esfera, '2027-06-01'))).toContain('Santander');
    // as relações novas aparecem no portal (fonte + link + data, nunca o trecho)
    const out = JSON.stringify(await portalCompanyPage(db, await orgId('Livelo'), '2027-06-01'));
    expect(out).toContain('Banco do Brasil');
    expect(out).toContain('Dotz');
    for (const r of NEW_REL) expect(out.includes(r.quote)).toBe(false);
    // Eros Canedo: o cargo segue "a confirmar" e a evidência atual não tem mais "Collapse"
    const q = ((await listRolesHandler(db, { q: 'eros' })).body as { items: { status: string }[] }).items;
    expect(q.map((r) => r.status)).toEqual(['to_confirm']);
    expect((await db.query(`SELECT 1 FROM intelligence.evidence WHERE excerpt LIKE '%Collapse%' AND id IN (SELECT evidence_id FROM intelligence.role_assignment)`)).rows).toHaveLength(0);
    const studio = (await getCompanyHandler(db, 'studio', { id: esfera, asOf: '2027-06-01', includeInferred: true })).body as { relations: { stale_validation: boolean }[] };
    expect(studio.relations.some((r) => r.stale_validation)).toBe(false); // a relação voltou a declarada: não há mais "vencida"
    await rollbackSeed(db, manifest!);
    expect(JSON.stringify(await relRows())).toBe(before);
    expect(await count('org_relation')).toBe(28); // as 28 do v3 (a Santander→Esfera continua no banco como "validação vencida")
  });

  it('sem a flag de pessoas, as relações entram mesmo assim e só os 39 cargos são recusados', async () => {
    const plan = await planSeedLoad(db, V7, V7_VER);
    expect(plan.counts.rejected).toBe(39);
    expect(plan.records.filter((r) => r.action === 'create').length).toBe(29 + 36);
  });
});
