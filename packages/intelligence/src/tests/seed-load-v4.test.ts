import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import {
  createWatchlist, generateAlerts, getExecutiveHandler, getMoveHandler, listAlertsHandler, listMovesHandler, loadSeed, planSeedLoad,
  portalCompanyPage, portalExecutivePage, reviewMoveHandler, rollbackSeed, searchExecutivesHandler, validateSeed, watch, type SeedDataset, type VerificationReport,
} from '../index';
import { ev, newDb, po } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V3 = read<SeedDataset>('seed.public.v3.json');
const V3_VER = read<VerificationReport>('seed.public.v3.verification.json');
const V4 = read<SeedDataset>('seed.public.v4.json');
const V4_VER = read<VerificationReport>('seed.public.v4.verification.json');
const ON = { personIngestion: true, extendedPersonalData: false };

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);
const orgId = async (n: string) => (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE normalized_name = $1`, [n])).rows[0]!.id;
const personId = async (n: string) => (await db.query<{ id: string }>(`SELECT id FROM intelligence.person WHERE normalized_name = $1`, [n])).rows[0]!.id;

describe('seed.public.v4 (arquivos reais)', () => {
  it('estrutura válida: v3 inteira + 20 cargos de 10 organizações, só campos permitidos', () => {
    expect(validateSeed(V4)).toEqual([]);
    expect(V4.schemaVersion).toBe('intelligence-seed/2');
    expect(V4.organizations).toHaveLength(29);
    expect(V4.relations).toHaveLength(28);
    expect(V4.roles).toHaveLength(20);
    expect(new Set(V4.roles!.map((r) => r.orgKey)).size).toBe(10);
    // a v3 continua dentro da v4, sem alteração
    expect(V4.organizations).toEqual(V3.organizations);
    expect(V4.relations).toEqual(V3.relations);
    for (const r of V4.roles!) expect(Object.keys(r).every((k) => ['personName', 'orgKey', 'title', 'body', 'sourceId', 'sourceLevel', 'quote', 'validFrom'].includes(k))).toBe(true);
    // nenhum dado de contato nem link de perfil em lugar nenhum do conjunto de cargos
    expect(JSON.stringify(V4.roles)).not.toMatch(/@|https?:|\+\d|\(\d{2}\)|linkedin|theorg/i);
  });

  it('verificador: 77/77 citações literais (29 + 28 + 20), as 18 fontes verificadas e as 10 de diretoria com captura conferida', () => {
    expect(V4_VER.datasetId).toBe('seed.public.v4');
    expect(V4_VER.records).toHaveLength(77);
    expect(V4_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(V4_VER.sources).toHaveLength(18);
    for (const s of V4_VER.sources) expect(s).toMatchObject({ status: 'verified', http_status: 200 });
    const roleSources = [...new Set(V4.roles!.map((r) => r.sourceId))];
    expect(roleSources).toHaveLength(10);
    for (const id of roleSources) {
      const src = V4.sources.find((s) => s.id === id)!;
      expect(src.method).toBe('capture');
      const v = V4_VER.sources.find((s) => s.id === id)!;
      expect(v.url).toBe(src.url);
      // metadados da captura (sem texto da página) estão no git e batem com o relatório
      const metaPath = file(`captures/${id}.meta.json`);
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
      expect(meta).not.toHaveProperty('text');
      expect(meta.url).toBe(src.url);
      expect(meta.sha256Claimed).toBe(v.content_sha256);
    }
  });

  it('só página OFICIAL de RI/administração da própria empresa, certeza declarada, nenhuma fonte secundária', () => {
    for (const r of V4.roles!) {
      expect(r.sourceLevel).toBe('oficial');
      const url = V4.sources.find((s) => s.id === r.sourceId)!.url;
      expect(url).not.toMatch(/linkedin|theorg/i);
      expect(r.quote.length).toBeLessThanOrEqual(300);
    }
  });
});

describe('carga dos cargos (v4)', () => {
  it('SEM a flag de pessoas: o plano recusa os 20 cargos com o motivo; a carga não cria nenhuma pessoa', async () => {
    const plan = await planSeedLoad(db, V4, V4_VER);
    expect(plan.ok).toBe(true);
    expect(plan.counts).toEqual({ create: 57, exists: 0, rejected: 20 });
    expect(plan.records.filter((r) => r.action === 'rejected').every((r) => /ingestão de pessoas desligada/.test(r.reason!))).toBe(true);
    const { manifest } = await loadSeed(db, V4, V4_VER);
    expect(manifest!.personsCreated).toBeUndefined();
    expect([await count('person'), await count('role_assignment')]).toEqual([0, 0]);
  });

  it('v4 sobre v3 (como no staging): 20 novos, 57 existentes; pessoas e cargos declarados com evidência e validação; nenhum Move', async () => {
    await loadSeed(db, V3, V3_VER);
    const evidenceBefore = await count('evidence');
    const plan = await planSeedLoad(db, V4, V4_VER, ON);
    expect(plan.counts).toEqual({ create: 20, exists: 57, rejected: 0 });
    const { manifest } = await loadSeed(db, V4, V4_VER, ON);
    expect(manifest!.rolesCreated).toHaveLength(20);
    expect(manifest!.personsCreated).toHaveLength(20);
    expect(await count('evidence')).toBe(evidenceBefore + 20 + 28); // cargos novos + 28 relações revalidadas
    expect([await count('person'), await count('role_assignment'), await count('move')]).toEqual([20, 20, 0]);
    const bad = await db.query(`SELECT 1 FROM intelligence.role_assignment WHERE certainty <> 'declared' OR evidence_id IS NULL OR validated_at IS NULL OR inference_basis IS NOT NULL`);
    expect(bad.rows).toHaveLength(0);
    // cada pessoa só tem nome (sem URL de perfil, sem atributos ampliados)
    expect((await db.query(`SELECT 1 FROM intelligence.person WHERE public_profile_url IS NOT NULL`)).rows).toHaveLength(0);
    expect(await count('person_extended')).toBe(0);
    // GPA: a data de eleição que a página declara; os demais, a data da verificação
    const gpa = (await db.query<{ valid_from: string }>(
      `SELECT r.valid_from::text FROM intelligence.role_assignment r JOIN intelligence.person p ON p.id = r.person_id WHERE p.normalized_name = $1`, ['alexandre de jesus santoro'])).rows[0]!;
    expect(gpa.valid_from).toBe('2026-01-05');
    // conselho: o cargo diz qual órgão
    const rd = await db.query<{ title: string }>(`SELECT title FROM intelligence.role_assignment WHERE title LIKE '%Conselho%'`);
    expect(rd.rows.map((r) => r.title)).toEqual(['Presidente (Conselho de Administração)']);
  });

  it('idempotente (segunda carga só revalida) e o desfazer restaura tudo (cargos, pessoas, evidência e data anteriores)', async () => {
    await loadSeed(db, V3, V3_VER);
    const snap = async () => ({
      rel: (await db.query(`SELECT id, evidence_id, validated_at FROM intelligence.org_relation ORDER BY id`)).rows,
      ev: await count('evidence'),
    });
    const antes = await snap();
    const first = await loadSeed(db, V4, V4_VER, ON);
    const second = await planSeedLoad(db, V4, V4_VER, ON);
    expect(second.counts).toEqual({ create: 0, exists: 77, rejected: 0 });
    const again = await loadSeed(db, V4, V4_VER, ON);
    expect(again.manifest!.rolesCreated).toBeUndefined();
    expect(again.manifest!.rolesRevalidatedPrevious).toHaveLength(20);
    expect([await count('person'), await count('role_assignment')]).toEqual([20, 20]);
    await rollbackSeed(db, again.manifest!);
    expect([await count('person'), await count('role_assignment')]).toEqual([20, 20]); // o 1º manifesto ainda vale
    const r = await rollbackSeed(db, first.manifest!);
    expect(r).toMatchObject({ rolesRemoved: 20, personsRemoved: 20 });
    expect([await count('person'), await count('role_assignment'), await count('organization'), await count('org_relation')]).toEqual([0, 0, 29, 28]);
    expect(await snap()).toEqual(antes);
  });

  it('pessoa suprimida a pedido do titular não é recriada pela carga', async () => {
    await loadSeed(db, V3, V3_VER);
    await loadSeed(db, V4, V4_VER, ON);
    const id = await personId('gustavo henrique santos de sousa');
    await db.query(`UPDATE intelligence.person SET suppressed_at = now() WHERE id = $1`, [id]);
    const plan = await planSeedLoad(db, V4, V4_VER, ON);
    expect(plan.counts).toEqual({ create: 0, exists: 76, rejected: 1 });
    expect(plan.records.find((r) => r.action === 'rejected')!.reason).toMatch(/suprimida/);
  });

  it('exibição pública: fato + fonte + link + data, nunca a citação; e o portal só mostra declarado', async () => {
    await loadSeed(db, V3, V3_VER);
    await loadSeed(db, V4, V4_VER, ON);
    const bv = await portalCompanyPage(db, await orgId('banco bv'), '2026-12-01');
    const gus = bv!.people.find((p) => p.full_name === 'Gustavo Henrique Santos de Sousa')!;
    expect(gus).toBeTruthy();
    const exec = await portalExecutivePage(db, await personId('gustavo henrique santos de sousa'));
    const out = JSON.stringify([bv, exec, (await searchExecutivesHandler(db, { q: 'gustavo' })).body,
      (await getExecutiveHandler(db, 'public', { id: await personId('gustavo henrique santos de sousa') })).body]);
    expect(out).toContain('ri.bv.com.br');
    for (const q of V4.roles!.map((r) => r.quote)) expect(out.includes(q)).toBe(false);
    expect(out).not.toMatch(/"excerpt"/);
  });
});

describe('fonte secundária (LinkedIn/The Org): "a confirmar", nunca fato', () => {
  const sec = (over: Record<string, unknown> = {}): SeedDataset => ({
    schemaVersion: 'intelligence-seed/2', datasetId: 'seed.teste.secundaria',
    sources: [{ id: 'theorg-x', name: 'MOCK organograma público', url: 'https://theorg.com/org/mock-exemplo', method: 'capture' }],
    organizations: [{ key: 'x', legalName: 'MOCK Exemplo S.A.', kind: 'company', sourceId: 'theorg-x', quote: 'MOCK Exemplo S.A. organograma público' }],
    relations: [],
    roles: [{ personName: 'MOCK Pessoa Exemplo', orgKey: 'x', title: 'Diretora Comercial', sourceId: 'theorg-x', sourceLevel: 'secundaria', quote: 'MOCK Pessoa Exemplo Diretora Comercial', ...over }],
  });
  const ver = (ds: SeedDataset): VerificationReport => ({
    datasetId: ds.datasetId, verifiedAt: '2026-11-23T12:00:00Z',
    sources: [{ id: 'theorg-x', url: ds.sources[0]!.url, status: 'verified', http_status: 200, fetched_at: '2026-11-23T12:00:00Z', content_sha256: 'a'.repeat(64) }],
    records: [{ ref: 'organization:x', source_id: 'theorg-x', quote_found: true }, { ref: 'role:x>MOCK Pessoa Exemplo>Diretora Comercial', source_id: 'theorg-x', quote_found: true }],
  });

  it('LinkedIn/The Org marcados como oficial são recusados; secundária entra como INFERIDA com a base "a confirmar"', async () => {
    expect(validateSeed(sec({ sourceLevel: 'oficial' })).join(' ')).toMatch(/SECUNDÁRIA/);
    const ds = sec();
    expect(validateSeed(ds)).toEqual([]);
    const { manifest } = await loadSeed(db, ds, ver(ds), ON);
    expect(manifest!.rolesCreated).toHaveLength(1);
    const r = (await db.query<{ certainty: string; inference_basis: string }>(`SELECT certainty, inference_basis FROM intelligence.role_assignment`)).rows[0]!;
    expect(r.certainty).toBe('inferred');
    expect(r.inference_basis).toMatch(/a confirmar/);
  });

  it('o portal não mostra a pessoa como fato; só o Studio vê, marcada como inferida', async () => {
    const ds = sec();
    await loadSeed(db, ds, ver(ds), ON);
    const oid = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE legal_name = 'MOCK Exemplo S.A.'`)).rows[0]!.id;
    const portal = await portalCompanyPage(db, oid, '2026-12-01');
    expect(portal!.people).toHaveLength(0);
    const pub = await getExecutiveHandler(db, 'public', { id: await personId('mock pessoa exemplo') });
    expect(JSON.stringify(pub.body)).not.toContain('Diretora Comercial');
  });

  it('confirmação oficial (role-observation) promove a declarado, sem Move; nova leitura secundária nunca fecha nem troca cargo oficial', async () => {
    const ds = sec();
    await loadSeed(db, ds, ver(ds), ON);
    const base = { personName: 'MOCK Pessoa Exemplo', orgName: 'MOCK Exemplo S.A.', kind: 'present' as const };
    // secundária repetida: continua a confirmar
    const s1 = await po(db, { ...base, title: 'Diretora Comercial', sourceLevel: 'secundaria', evidenceId: await ev(db, 'sec1', '2026-11-24T00:00:00Z'), observedAt: '2026-11-24T00:00:00Z' }, ON);
    expect(s1.outcome).toBe('unchanged');
    expect((await db.query<{ certainty: string }>(`SELECT certainty FROM intelligence.role_assignment`)).rows[0]!.certainty).toBe('inferred');
    // oficial do MESMO cargo: confirma
    const o1 = await po(db, { ...base, title: 'Diretora Comercial', evidenceId: await ev(db, 'ofc1', '2026-11-25T00:00:00Z'), observedAt: '2026-11-25T00:00:00Z' }, ON);
    expect(o1.outcome).toBe('unchanged');
    const row = (await db.query<{ certainty: string; inference_basis: string | null }>(`SELECT certainty, inference_basis FROM intelligence.role_assignment`)).rows[0]!;
    expect(row).toEqual({ certainty: 'declared', inference_basis: null });
    expect(await count('move')).toBe(0);
    // secundária com outro cargo e saída por fonte secundária: ignoradas, o cargo oficial segue aberto, nenhum Move
    const s2 = await po(db, { ...base, title: 'Diretora de Marketing', sourceLevel: 'secundaria', evidenceId: await ev(db, 'sec2', '2026-11-26T00:00:00Z'), observedAt: '2026-11-26T00:00:00Z' }, ON);
    const s3 = await po(db, { ...base, title: 'Diretora Comercial', kind: 'left', sourceLevel: 'secundaria', evidenceId: await ev(db, 'sec3', '2026-11-27T00:00:00Z'), observedAt: '2026-11-27T00:00:00Z' }, ON);
    expect([s2.outcome, s3.outcome]).toEqual(['ignored', 'ignored']);
    expect((await db.query(`SELECT 1 FROM intelligence.role_assignment WHERE valid_to IS NULL AND certainty = 'declared'`)).rows).toHaveLength(1);
    expect(await count('move')).toBe(0);
  });

  it('campos além de nome, cargo e empresa são recusados (contato, foto, perfil, biografia)', () => {
    for (const extra of [{ email: 'a@b.c' }, { phone: '1' }, { photoUrl: 'x' }, { profileUrl: 'x' }, { bio: 'x' }]) {
      expect(validateSeed(sec(extra)).join(' ')).toMatch(/não permitido/);
    }
    expect(validateSeed(sec({ personName: 'pessoa@exemplo.com' })).join(' ')).toMatch(/nome completo/);
    expect(validateSeed(sec({ quote: 'MOCK Outra Pessoa Diretora Comercial' })).join(' ')).toMatch(/não contém o nome/);
    expect(validateSeed(sec({ quote: 'MOCK Pessoa Exemplo Presidente do Conselho' })).join(' ')).toMatch(/não contém o cargo/);
  });
});

describe('Moves com duas leituras (antes e depois)', () => {
  const T2 = '2027-02-01T10:00:00Z';
  async function setup() {
    await loadSeed(db, V3, V3_VER);
    await loadSeed(db, V4, V4_VER, ON);
    const r = await po(db, { personName: 'Alexandre de Jesus Santoro', orgName: 'GPA', title: 'Conselheiro', kind: 'present', evidenceId: await ev(db, 'gpa-depois', T2), observedAt: T2 }, ON);
    if (r.outcome !== 'move') throw new Error(`esperava move, veio ${r.outcome}`);
    return r.move;
  }

  it('primeira leitura é linha de base (sem Move); a segunda, com cargo diferente, gera Move com as DUAS evidências', async () => {
    const m = await setup();
    expect(m.kind).toBe('title_change');
    expect(m.status).toBe('detected');
    type Rd = { title: string; organization: string; certainty: string; valid_to: string | null; evidence: { id: string; source_url: string } };
    const view = (await getMoveHandler(db, 'studio', { id: m.id })).body as { move: { before: Rd; after: Rd; evidence: { id: string } } };
    expect(view.move.before).toMatchObject({ title: 'Diretor Presidente', organization: 'GPA', certainty: 'declared', valid_to: expect.any(String) });
    expect(view.move.before.evidence.source_url).toBe('https://www.gpari.com.br/governanca-corporativa/administracao/');
    expect(view.move.after).toMatchObject({ title: 'Conselheiro', certainty: 'declared', valid_to: null });
    expect(view.move.after.evidence.source_url).toBe('https://mock.invalid/gpa-depois');
    expect(view.move.evidence.id).toBe(view.move.after.evidence.id);
    // nada do trecho da página nas leituras (só fato, fonte, link e data)
    expect(JSON.stringify(view)).not.toMatch(/excerpt/);
  });

  it('portal: Move não revisado não existe (404 igual a inexistente); depois de confirmado aparece com antes/depois', async () => {
    const m = await setup();
    expect((await getMoveHandler(db, 'public', { id: m.id })).status).toBe(404);
    expect(((await listMovesHandler(db, 'public', {})).body as { items: unknown[] }).items).toHaveLength(0);
    expect((await reviewMoveHandler(db, 'revisor-teste', { id: m.id, status: 'confirmed' })).status).toBe(200);
    const pub = await getMoveHandler(db, 'public', { id: m.id });
    expect(pub.status).toBe(200);
    const body = pub.body as { move: { before: { title: string }; after: { title: string } } };
    expect([body.move.before.title, body.move.after.title]).toEqual(['Diretor Presidente', 'Conselheiro']);
  });

  it('alerta de watchlist traz o Move com as duas leituras; nasce pendente de revisão', async () => {
    const m = await setup();
    const w = await createWatchlist(db, 'MOCK minha lista', 'usuario-teste');
    await watch(db, w, 'organization', await orgId('gpa'));
    await generateAlerts(db, { moveIds: [m.id] });
    const body = (await listAlertsHandler(db, { status: 'pending_review' })).body as { items: { status: string; move_id: string; move: { before: { title: string }; after: { title: string } } | null }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ status: 'pending_review', move_id: m.id });
    expect(body.items[0]!.move!.before.title).toBe('Diretor Presidente');
    expect(body.items[0]!.move!.after.title).toBe('Conselheiro');
  });
});
