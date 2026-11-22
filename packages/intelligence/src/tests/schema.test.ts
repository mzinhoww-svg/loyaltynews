import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import { addOrgChartEdge, addOrgRelation, addRole, getOrgChart, setExtendedAttributes, upsertOrganization, addEvidence, DEFAULT_CONFIG, ExtendedPersonalDataDisabledError } from '../index';
import { MOCK_ORGS, MOCK_PEOPLE } from '../../fixtures/mock-entities';
import { ev, newDb, rp } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

async function seedRoles() {
  const e = await ev(db, 'seed');
  const org = await upsertOrganization(db, { legalName: MOCK_ORGS.alfa, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  const ana = (await rp(db, { fullName: MOCK_PEOPLE.ana.name, organizationId: org, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' })).id;
  const bruno = (await rp(db, { fullName: MOCK_PEOPLE.bruno.name, organizationId: org, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' })).id;
  const r1 = await addRole(db, { personId: ana, organizationId: org, title: 'CEO', validFrom: '2024-01-01', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  const r2 = await addRole(db, { personId: bruno, organizationId: org, title: 'Diretor de CRM', validFrom: '2025-03-01', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  return { e, org, ana, bruno, r1, r2 };
}

describe('ADR-009: evidência e data obrigatórias (teste de migração)', () => {
  it('colunas evidence_id e observed_at são NOT NULL em cargos, relações, organograma, pessoas e organizações', async () => {
    const r = await db.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema='intelligence' AND column_name IN ('evidence_id','observed_at')
          AND table_name IN ('role_assignment','org_relation','org_chart_edge','person','organization')`,
    );
    expect(r.rows.length).toBe(10);
    expect(r.rows.filter((x) => x.is_nullable !== 'NO')).toEqual([]);
    const v = await db.query<{ table_name: string; is_nullable: string }>(
      `SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema='intelligence' AND column_name='validated_at' AND table_name IN ('role_assignment','org_relation','org_chart_edge')`,
    );
    expect(v.rows.length).toBe(3);
    expect(v.rows.every((x) => x.is_nullable === 'NO')).toBe(true);
  });

  it('cargo sem evidência é recusado pelo banco', async () => {
    const { org, ana } = await seedRoles();
    await expect(
      db.query(
        `INSERT INTO intelligence.role_assignment (person_id, organization_id, title, normalized_title, valid_from, observed_at, validated_at)
         VALUES ($1,$2,'X','x','2025-01-01', now(), now())`,
        [ana, org],
      ),
    ).rejects.toThrow();
  });

  it('só fonte pública é aceita como evidência', async () => {
    await expect(
      db.query(`INSERT INTO intelligence.evidence (source_url, source_name, source_class, retrieved_at) VALUES ('https://x.invalid/a','n','private',now())`),
    ).rejects.toThrow();
    await expect(addEvidence(db, { sourceUrl: 'ftp://x', sourceName: 'n', retrievedAt: '2026-11-01T00:00:00Z' })).rejects.toThrow();
    await expect(addEvidence(db, { sourceUrl: 'https://x.invalid/a', sourceName: 'n', retrievedAt: '2026-11-01T00:00:00Z', excerpt: 'x'.repeat(501) })).rejects.toThrow();
  });

  it('vínculo inferido exige base de inferência; vigência não pode ser invertida', async () => {
    const { e, org, r1, r2 } = await seedRoles();
    await expect(
      addOrgChartEdge(db, { organizationId: org, superiorRoleId: r1, subordinateRoleId: r2, validFrom: '2025-03-01', certainty: 'inferred', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' }),
    ).rejects.toThrow();
    await expect(
      addOrgChartEdge(db, { organizationId: org, superiorRoleId: r1, subordinateRoleId: r2, validFrom: '2025-03-01', validTo: '2025-01-01', certainty: 'declared', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' }),
    ).rejects.toThrow();
    const o2 = await upsertOrganization(db, { legalName: MOCK_ORGS.beta, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    await expect(
      addOrgRelation(db, { fromOrgId: o2, toOrgId: o2, type: 'partner_of', validFrom: '2025-01-01', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' }),
    ).rejects.toThrow();
  });
});

describe('DP-11 P4: dado de pessoa limitado a nome, cargo e empresa; flag ampliada desligada', () => {
  it('flag nasce desligada no código e no banco', async () => {
    expect(DEFAULT_CONFIG.extendedPersonalData).toBe(false);
    const r = await db.query<{ bool_value: boolean }>(`SELECT bool_value FROM intelligence.intel_settings WHERE key='extended_personal_data'`);
    expect(r.rows[0]!.bool_value).toBe(false);
  });

  it('pessoa só com fonte pública (nome + cargo + empresa) é aceita', async () => {
    const { ana } = await seedRoles();
    const r = await db.query<{ full_name: string }>(`SELECT full_name FROM intelligence.person WHERE id=$1`, [ana]);
    expect(r.rows[0]!.full_name).toBe(MOCK_PEOPLE.ana.name);
  });

  it('atributo além de nome/cargo/empresa é recusado com a flag desligada (aplicação)', async () => {
    const e = await ev(db, 'x');
    await expect(
      rp(db, { fullName: 'MOCK Pessoa X', evidenceId: e, observedAt: '2026-11-01T00:00:00Z', extra: { email: 'mock@mock.invalid' } }),
    ).rejects.toBeInstanceOf(ExtendedPersonalDataDisabledError);
    const { ana } = await seedRoles();
    await expect(setExtendedAttributes(db, ana, { birth_year: 1980 }, { evidenceId: e, observedAt: '2026-11-01T00:00:00Z' })).rejects.toBeInstanceOf(
      ExtendedPersonalDataDisabledError,
    );
  });

  it('atributo ampliado é recusado pelo banco mesmo se a aplicação for contornada (gatilho)', async () => {
    const { e, ana } = await seedRoles();
    await expect(
      db.query(`INSERT INTO intelligence.person_extended (person_id, attributes, evidence_id, observed_at) VALUES ($1,'{"a":1}',$2,now())`, [ana, e]),
    ).rejects.toThrow(/extended_personal_data_disabled/);
  });

  it('pessoa sem evidência é recusada', async () => {
    await expect(
      rp(db, { fullName: 'MOCK Sem Fonte', evidenceId: '', observedAt: '2026-11-01T00:00:00Z' }),
    ).rejects.toThrow(/evidence_required/);
    await expect(
      db.query(`INSERT INTO intelligence.person (full_name, normalized_name, observed_at) VALUES ('a','a',now())`),
    ).rejects.toThrow();
  });

  it('homônimos sem URL nem organização em comum não são fundidos', async () => {
    const e = await ev(db, 'h');
    const a = await rp(db, { fullName: 'MOCK João Silva', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    const b = await rp(db, { fullName: 'MOCK João Silva', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('organograma: vínculo presumido nunca aparece como fato (teste de renderização)', () => {
  it('aresta declarada = fato; inferida só aparece se pedida e rotulada', async () => {
    const { e, org, r1, r2 } = await seedRoles();
    const e2 = await ev(db, 'orgchart');
    await addOrgChartEdge(db, { organizationId: org, superiorRoleId: r1, subordinateRoleId: r2, validFrom: '2025-03-01', certainty: 'declared', evidenceId: e2, observedAt: '2026-11-01T00:00:00Z' });
    const p3 = (await rp(db, { fullName: MOCK_PEOPLE.carla.name, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' })).id;
    const r3 = await addRole(db, { personId: p3, organizationId: org, title: 'Gerente de Dados', validFrom: '2025-06-01', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    await addOrgChartEdge(db, { organizationId: org, superiorRoleId: r2, subordinateRoleId: r3, validFrom: '2025-06-01', certainty: 'inferred', inferenceBasis: 'mesma diretoria no site', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });

    const facts = await getOrgChart(db, org, '2026-11-22');
    expect(facts).toHaveLength(1);
    expect(facts[0]!.certainty).toBe('declared');
    expect(facts[0]!.display_label).toBe('fato (fonte declara)');

    const all = await getOrgChart(db, org, '2026-11-22', { includeInferred: true });
    expect(all).toHaveLength(2);
    const inf = all.find((x) => x.certainty === 'inferred')!;
    expect(inf.display_label).toMatch(/inferido/);
    expect(inf.display_label).not.toMatch(/^fato/);
  });
});
