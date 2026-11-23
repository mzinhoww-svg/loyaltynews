import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import { loadSeed, planSeedLoad, rollbackSeed, validateSeed, type SeedDataset, type VerificationReport } from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V1 = read<SeedDataset>('seed.public.v1.json');
const V1_VER = read<VerificationReport>('seed.public.v1.verification.json');
const V2 = read<SeedDataset>('seed.public.v2.json');
const V2_VER = read<VerificationReport>('seed.public.v2.verification.json');

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);

describe('seed.public.v2: 20 organizações e 20 relações declaradas, todas verificadas (arquivos reais)', () => {
  it('estrutura válida, sem pessoas e sem campo de inferência', () => {
    expect(validateSeed(V2)).toEqual([]);
    expect(V2.organizations).toHaveLength(20);
    expect(V2.relations).toHaveLength(20);
    expect(V2.persons).toEqual([]);
    for (const r of V2.relations) expect(Object.keys(r).every((k) => ['from', 'to', 'type', 'sourceId', 'quote', 'contextQuote'].includes(k))).toBe(true);
  });

  it('toda citação (e contexto) foi encontrada na página; todas as fontes verificadas com HTTP 200', () => {
    expect(V2_VER.datasetId).toBe('seed.public.v2');
    expect(V2_VER.records).toHaveLength(40);
    expect(V2_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(V2_VER.sources.every((s) => s.status === 'verified' && s.http_status === 200 && /^[0-9a-f]{64}$/.test(s.content_sha256!))).toBe(true);
  });

  it('a fonte capturada pelo navegador tem texto cujo sha256 confere com o calculado no navegador e contém a citação', () => {
    const cap = read<{ url: string; text: string; sha256Claimed: string; length: number; capturedAt: string }>('captures/dotz-home.json');
    expect(createHash('sha256').update(cap.text).digest('hex')).toBe(cap.sha256Claimed);
    expect(cap.text.length).toBe(cap.length);
    const ver = V2_VER.sources.find((s) => s.id === 'dotz-home')!;
    expect(ver).toMatchObject({ method: 'openbot_browser', url: cap.url, content_sha256: cap.sha256Claimed, fetched_at: cap.capturedAt });
    for (const rec of [...V2.organizations, ...V2.relations].filter((r) => r.sourceId === 'dotz-home')) expect(cap.text).toContain(rec.quote);
  });

  it('toda citação não vazia aparece nos textos que o verificador conferiu (checagem independente das citações do browser)', () => {
    const cap = read<{ text: string }>('captures/dotz-home.json');
    const dotz = [...V2.organizations, ...V2.relations].filter((r) => r.sourceId === 'dotz-home');
    expect(dotz.length).toBe(4); // Banco do Brasil, Banco BV e as duas relações do Dotz
    expect(dotz.every((r) => cap.text.includes(r.quote))).toBe(true);
  });
});

describe('carga do v2', () => {
  it('dry-run: 40 a criar, nenhum recusado; carga cria 20 organizações e 20 relações declaradas com evidência', async () => {
    expect(await planSeedLoad(db, V2, V2_VER)).toMatchObject({ ok: true, counts: { create: 40, exists: 0, rejected: 0 } });
    expect(await count('organization')).toBe(0);

    const { manifest } = await loadSeed(db, V2, V2_VER);
    expect(manifest!.organizationsCreated).toHaveLength(20);
    expect(manifest!.relationsCreated).toHaveLength(20);
    expect([await count('person'), await count('role_assignment'), await count('move'), await count('org_chart_edge')]).toEqual([0, 0, 0, 0]);

    const rows = await db.query<{ certainty: string; excerpt: string; content_hash: string; source_url: string; is_mock: boolean; relation_type: string }>(
      `SELECT x.certainty, x.relation_type, e.excerpt, e.content_hash, e.source_url, e.is_mock
         FROM intelligence.org_relation x JOIN intelligence.evidence e ON e.id = x.evidence_id`,
    );
    expect(rows.rows).toHaveLength(20);
    expect(rows.rows.every((r) => r.certainty === 'declared' && !r.is_mock && r.source_url.startsWith('https://') && /^sha256:[0-9a-f]{64}$/.test(r.content_hash))).toBe(true);
    // relações da lista de associadas carregam o contexto da página junto da citação
    const assoc = rows.rows.filter((r) => r.source_url === 'https://web.abemf.com.br/associados/');
    expect(assoc).toHaveLength(12);
    expect(assoc.every((r) => r.excerpt.startsWith('Empresas Associadas Conheça as empresas que fazem parte da ABEMF […] '))).toBe(true);
    expect(rows.rows.filter((r) => r.relation_type === 'partner_of')).toHaveLength(6);
    // evidência da fonte capturada pelo navegador guarda o sha do navegador
    const dotz = await db.query<{ content_hash: string }>(`SELECT content_hash FROM intelligence.evidence WHERE source_url = 'https://www.dotz.com.br/home' LIMIT 1`);
    expect(dotz.rows[0]!.content_hash).toBe(`sha256:${V2_VER.sources.find((s) => s.id === 'dotz-home')!.content_sha256}`);
  });

  it('v2 sobre v1 já carregado: o que existe é reconhecido, só o novo é criado; nada duplica', async () => {
    await loadSeed(db, V1, V1_VER);
    const snap = async () => (await db.query<{ id: string; evidence_id: string; validated_at: string }>(`SELECT id, evidence_id, validated_at FROM intelligence.org_relation ORDER BY id`)).rows.map((r) => ({ ...r, validated_at: new Date(r.validated_at).toISOString() }));
    const antes = await snap();
    const evidenciasAntes = await count('evidence');
    const plan = await planSeedLoad(db, V2, V2_VER);
    // existentes: 5 organizações do v1 e as 2 relações do v1
    expect(plan.counts).toEqual({ create: 33, exists: 7, rejected: 0 });
    const { manifest } = await loadSeed(db, V2, V2_VER);
    expect(manifest!.organizationsCreated).toHaveLength(15);
    expect(manifest!.relationsCreated).toHaveLength(18);
    expect([await count('organization'), await count('org_relation')]).toEqual([20, 20]);
    // desfazer o v2 deixa o v1 INTACTO: contagens E também evidência e data de validação das 2 relações que o v2 revalidou
    expect(manifest!.relationsRevalidatedPrevious).toHaveLength(2);
    await rollbackSeed(db, manifest!);
    expect([await count('organization'), await count('org_relation')]).toEqual([5, 2]);
    expect(await snap()).toEqual(antes);
    expect(await count('evidence')).toBe(evidenciasAntes);
  });

  it('citação do navegador adulterada é recusada pelo plano (relatório diz não encontrada)', async () => {
    const ver = JSON.parse(JSON.stringify(V2_VER)) as VerificationReport;
    ver.records.find((r) => r.ref === 'organization:banco-bv')!.quote_found = false;
    const plan = await planSeedLoad(db, V2, ver);
    expect(plan.records.find((r) => r.ref === 'organization:banco-bv')).toMatchObject({ action: 'rejected' });
    expect(plan.records.find((r) => r.ref === 'relation:dotz>partner_of>banco-bv')).toMatchObject({ action: 'rejected', reason: 'organização da relação foi recusada' });
    expect(plan.counts.rejected).toBe(2);
  });

  it('contextQuote grande demais é recusado na estrutura', () => {
    const bad = JSON.parse(JSON.stringify(V2)) as SeedDataset;
    bad.relations[2]!.contextQuote = 'x'.repeat(480);
    expect(validateSeed(bad).join()).toMatch(/excedem 500/);
  });
});
