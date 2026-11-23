import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import {
  confirmRoleHandler, getExecutiveHandler, listRolesHandler, loadSeed, planSeedLoad, portalCompanyPage, rereadSourcesFromSeed, rollbackSeed, validateSeed,
  type SeedDataset, type VerificationReport,
} from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V5 = read<SeedDataset>('seed.public.v5.json');
const V5_VER = read<VerificationReport>('seed.public.v5.verification.json');
const V6 = read<SeedDataset>('seed.public.v6.json');
const V6_VER = read<VerificationReport>('seed.public.v6.verification.json');
const ON = { personIngestion: true, extendedPersonalData: false };

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);
const orgId = async (n: string) => (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE legal_name = $1`, [n])).rows[0]!.id;
const secondary = V6.roles!.filter((r) => r.sourceLevel === 'secundaria');

describe('seed.public.v6 (arquivos reais): fonte secundária, "a confirmar"', () => {
  it('v5 intacta + 7 cargos secundários de 5 organizações; só nome, cargo e empresa; fontes só The Org; nada de LinkedIn nesta entrega', () => {
    expect(validateSeed(V6)).toEqual([]);
    expect(V6.roles!.slice(0, 32)).toEqual(V5.roles);
    expect(V6.organizations).toEqual(V5.organizations);
    expect(secondary).toHaveLength(7);
    expect(new Set(secondary.map((r) => r.orgKey))).toEqual(new Set(['genial', 'esfera', 'stix', 'juntos-somos-mais', 'bravium']));
    for (const r of secondary) {
      expect(Object.keys(r).sort()).toEqual(['orgKey', 'personName', 'quote', 'sourceId', 'sourceLevel', 'title']);
      const src = V6.sources.find((s) => s.id === r.sourceId)!;
      expect(src.url).toMatch(/^https:\/\/theorg\.com\/org\//);
      expect(r.quote.length).toBeLessThanOrEqual(80); // só o fato (nome + cargo), nunca texto de perfil
    }
    expect(JSON.stringify(secondary)).not.toMatch(/@|\+\d|linkedin\.com/i);
    // nunca as organizações classe C nem as sem entidade própria na fonte (sem presumir pelo controlador)
    expect(secondary.some((r) => ['azul', 'smiles', 'latam-pass', 'clube-giro', 'km-de-vantagens', 'santander', 'abemf'].includes(r.orgKey))).toBe(false);
  });

  it('verificador 94/94 (28 + 27 + 39), 29 fontes verified; capturas novas só com metadados no git', () => {
    expect(V6_VER.datasetId).toBe('seed.public.v6');
    expect(V6_VER.records).toHaveLength(94);
    expect(V6_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(V6_VER.sources).toHaveLength(29);
    for (const s of V6_VER.sources) expect(s).toMatchObject({ status: 'verified', http_status: 200 });
    for (const r of secondary) {
      const metaPath = file(`captures/${r.sourceId}.meta.json`);
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
      expect(meta).not.toHaveProperty('text');
      expect(meta.sha256Claimed).toBe(V6_VER.sources.find((s) => s.id === r.sourceId)!.content_sha256);
    }
  });
});

describe('carga do v6 sobre o v5', () => {
  it('cria só os 7 secundários, como INFERIDOS "a confirmar"; o portal não os mostra; o Studio os põe na fila; nenhum Move', async () => {
    await loadSeed(db, V5, V5_VER, ON);
    const ev0 = await count('evidence');
    const plan = await planSeedLoad(db, V6, V6_VER, ON);
    expect(plan.counts).toEqual({ create: 7, exists: 88, rejected: 0 }); // 28 orgs + 27 relações + 32 cargos oficiais + a marcação da Santander→Esfera (sem a relação neste banco: nada a marcar)
    const { manifest } = await loadSeed(db, V6, V6_VER, ON);
    expect(manifest!.rolesCreated).toHaveLength(7);
    expect(manifest!.personsCreated).toHaveLength(7);
    expect(await count('evidence')).toBe(ev0 + 27 + 32 + 7); // relações e cargos revalidados + 7 novos
    const inferred = await db.query<{ certainty: string; inference_basis: string }>(`SELECT certainty, inference_basis FROM intelligence.role_assignment WHERE certainty = 'inferred'`);
    expect(inferred.rows).toHaveLength(7);
    expect(inferred.rows.every((r) => /^a confirmar: fonte secundária/.test(r.inference_basis))).toBe(true);
    expect([await count('person'), await count('role_assignment'), await count('move')]).toEqual([39, 39, 0]);
    // portal: nenhuma das 5 organizações mostra pessoa; página da pessoa não mostra o cargo
    for (const n of ['Genial', 'Esfera', 'Stix', 'Juntos Somos +', 'Bravium']) {
      const id = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE legal_name ILIKE $1`, [n.replace('+', '%')])).rows[0]?.id;
      if (!id) continue;
      expect((await portalCompanyPage(db, id, '2027-01-01'))!.people).toHaveLength(0);
    }
    const pid = (await db.query<{ id: string }>(`SELECT id FROM intelligence.person WHERE full_name = 'Rodolfo Riechert'`)).rows[0]!.id;
    expect(JSON.stringify((await getExecutiveHandler(db, 'public', { id: pid })).body)).not.toContain('CEO');
    // Studio: fila "a confirmar" com os 7, nível secundário
    const q = ((await listRolesHandler(db, { certainty: 'inferred' })).body as { items: { source_level: string; status: string; evidence: { source_url: string } }[] }).items;
    expect(q).toHaveLength(7);
    expect(q.every((r) => r.source_level === 'secondary' && r.status === 'to_confirm' && r.evidence.source_url.startsWith('https://theorg.com/'))).toBe(true);
  });

  it('a releitura oficial NUNCA lê a fonte secundária; confirmar exige página oficial; desfazer remove só os 7', async () => {
    expect(rereadSourcesFromSeed(V6).flatMap((s) => s.roles)).toHaveLength(32);
    await loadSeed(db, V5, V5_VER, ON);
    const { manifest } = await loadSeed(db, V6, V6_VER, ON);
    const bravium = ((await listRolesHandler(db, { q: 'bravium' })).body as { items: { role_id: string }[] }).items[0]!;
    expect((await confirmRoleHandler(db, 'ed', { id: bravium.role_id, officialUrl: 'https://theorg.com/org/bravium' })).status).toBe(400);
    expect((await confirmRoleHandler(db, 'ed', { id: bravium.role_id, officialUrl: 'https://www.bravium.com.br/quem-somos' })).status).toBe(200);
    await rollbackSeed(db, manifest!);
    expect([await count('person'), await count('role_assignment')]).toEqual([32, 32]);
    expect(await orgId('Bravium')).toBeTruthy();
  });

  it('sem a flag de pessoas o plano do v6 recusa os 39 cargos', async () => {
    const plan = await planSeedLoad(db, V6, V6_VER);
    expect(plan.counts.rejected).toBe(39);
  });
});
