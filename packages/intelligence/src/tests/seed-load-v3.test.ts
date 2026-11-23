import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import {
  getCompanyHandler, listMovesHandler, loadSeed, planSeedLoad, portalCompanyPage, portalSearch, rollbackSeed, searchCompaniesHandler, validateSeed,
  type SeedDataset, type VerificationReport,
} from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const V2 = read<SeedDataset>('seed.public.v2.json');
const V2_VER = read<VerificationReport>('seed.public.v2.verification.json');
const V3 = read<SeedDataset & { revisaoHumana?: { key: string; motivo: string }[] }>('seed.public.v3.json');
const V3_VER = read<VerificationReport>('seed.public.v3.verification.json');

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);

describe('seed.public.v3 (arquivos reais)', () => {
  it('estrutura válida: 29 organizações, 28 relações, sem pessoas e sem campo de inferência', () => {
    expect(validateSeed(V3)).toEqual([]);
    expect(V3.organizations).toHaveLength(29);
    expect(V3.relations).toHaveLength(28);
    expect(V3.persons).toEqual([]);
    for (const r of V3.relations) expect(Object.keys(r).every((k) => ['from', 'to', 'type', 'sourceId', 'quote', 'contextQuote'].includes(k))).toBe(true);
  });

  it('todas as 57 citações foram encontradas e todas as 8 fontes verificadas (sem redirecionamento seguido)', () => {
    expect(V3_VER.datasetId).toBe('seed.public.v3');
    expect(V3_VER.records).toHaveLength(57);
    expect(V3_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(V3_VER.sources).toHaveLength(8);
    for (const s of V3_VER.sources) {
      expect(s).toMatchObject({ status: 'verified', http_status: 200 });
      expect(s.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // a URL verificada é a do dataset (nada de URL diferente por redirecionamento)
    const urls = Object.fromEntries(V3.sources.map((s) => [s.id, s.url]));
    for (const s of V3_VER.sources) expect(s.url).toBe(urls[s.id]);
    expect(urls['abemf-home']).toBe('https://web.abemf.com.br/'); // destino do redirecionamento de www.abemf.com.br
  });

  it('Santander → Esfera com a citação literal do título da página; Banco Santander (Brasil) → Grupo Santander pelo RI do banco', () => {
    const esf = V3.relations.find((r) => r.from === 'santander' && r.to === 'esfera')!;
    expect(esf).toMatchObject({ type: 'other', sourceId: 'esfera-site', quote: 'Esfera: O programa de pontos e recompensas do Santander' });
    const grp = V3.relations.find((r) => r.from === 'banco-santander-brasil' && r.to === 'grupo-santander')!;
    expect(grp.quote).toBe('pertence ao Grupo Santander, com forte presença na Europa e nas Américas');
    expect(grp.sourceId).toBe('santander-ri');
    // "Santander" (como a Esfera escreve) NÃO é ligado por presunção ao banco: nenhuma relação inventada entre os dois
    expect(V3.relations.some((r) => (r.from === 'santander' && r.to === 'banco-santander-brasil') || (r.from === 'banco-santander-brasil' && r.to === 'esfera'))).toBe(false);
  });

  it('Stix: o site dela NÃO é fonte; relações vêm da ABEMF e da Livelo; marcada para revisão humana', () => {
    expect(V3.sources.some((s) => /stix\.com\.br/i.test(s.url))).toBe(false);
    const stixRecs = [...V3.organizations, ...V3.relations].filter((r) => ('key' in r ? r.key === 'stix' : r.from === 'stix' || r.to === 'stix'));
    expect(stixRecs.length).toBeGreaterThanOrEqual(4);
    for (const r of stixRecs) expect(['abemf-associados', 'livelo-imprensa']).toContain(r.sourceId);
    expect(V3.revisaoHumana?.map((x) => x.key)).toEqual(['stix']);
    expect(V3.revisaoHumana![0]!.motivo).toMatch(/Em Evolução/);
  });

  it('as parcerias novas da Livelo citam a Livelo e o parceiro na MESMA frase literal', () => {
    for (const [to, nome] of [['madero', 'Madero'], ['shopee', 'Shopee'], ['bradesco-seguros', 'Bradesco Seguros'], ['genial', 'Genial']] as const) {
      const r = V3.relations.find((x) => x.to === to || x.from === to)!;
      expect(r.type).toBe('partner_of');
      expect(r.quote).toMatch(/Livelo/);
      expect(r.quote).toContain(nome);
      expect(r.quote).toMatch(/parceria/);
    }
  });
});

describe('carga do v3', () => {
  it('dry-run e carga: 57 registros novos; relações todas declaradas; sem pessoas, cargos ou Moves', async () => {
    expect(await planSeedLoad(db, V3, V3_VER)).toMatchObject({ ok: true, counts: { create: 57, exists: 0, rejected: 0 } });
    const { manifest } = await loadSeed(db, V3, V3_VER);
    expect(manifest!.organizationsCreated).toHaveLength(29);
    expect(manifest!.relationsCreated).toHaveLength(28);
    expect([await count('person'), await count('role_assignment'), await count('move')]).toEqual([0, 0, 0]);
    const nd = await db.query(`SELECT 1 FROM intelligence.org_relation WHERE certainty <> 'declared'`);
    expect(nd.rows).toHaveLength(0);
  });

  it('v3 sobre v2 já carregado (como no staging): reconhece os 40 existentes e cria só os 17 novos; desfazer o v3 deixa o v2 intacto', async () => {
    await loadSeed(db, V2, V2_VER);
    const snap = async () => (await db.query<{ id: string; evidence_id: string; validated_at: string }>(`SELECT id, evidence_id, validated_at FROM intelligence.org_relation ORDER BY id`)).rows.map((r) => ({ ...r, validated_at: new Date(r.validated_at).toISOString() }));
    const antes = await snap();
    const evidenciasAntes = await count('evidence');
    const plan = await planSeedLoad(db, V3, V3_VER);
    expect(plan.counts).toEqual({ create: 17, exists: 40, rejected: 0 });
    const { manifest } = await loadSeed(db, V3, V3_VER);
    expect(manifest!.organizationsCreated).toHaveLength(9);
    expect(manifest!.relationsCreated).toHaveLength(8);
    expect([await count('organization'), await count('org_relation')]).toEqual([29, 28]);
    // restauração COMPLETA: as 20 relações voltam à evidência e à data de validação anteriores (não só às contagens)
    expect(manifest!.relationsRevalidatedPrevious).toHaveLength(20);
    await rollbackSeed(db, manifest!);
    expect([await count('organization'), await count('org_relation')]).toEqual([20, 20]);
    expect(await snap()).toEqual(antes);
    expect(await count('evidence')).toBe(evidenciasAntes);
  });

  it('exibição pública continua sem o trecho: nenhuma citação do v3 aparece nas respostas', async () => {
    await loadSeed(db, V3, V3_VER);
    const id = async (n: string) => (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE normalized_name = $1`, [n])).rows[0]!.id;
    const out = JSON.stringify([
      await portalCompanyPage(db, await id('livelo'), '2026-12-01'),
      await portalCompanyPage(db, await id('esfera'), '2026-12-01'),
      await portalCompanyPage(db, await id('grupo santander'), '2026-12-01'),
      await portalSearch(db, 'santander'),
      (await getCompanyHandler(db, 'public', { id: await id('esfera'), asOf: '2026-12-01' })).body,
      (await searchCompaniesHandler(db, { q: 'a' })).body,
      (await listMovesHandler(db, 'studio', {})).body,
    ]);
    expect(out).toContain('Santander'); // controle: o dado real está na resposta (a relação Santander→Esfera)
    for (const q of new Set([...V3.organizations, ...V3.relations].map((r) => r.quote))) expect(out.includes(q)).toBe(false);
  });
});

describe('roteiro de carga (STAGING_LOAD_PLAN.md): caminhos utilizáveis', () => {
  const PLAN = readFileSync(fileURLToPath(new URL('../../STAGING_LOAD_PLAN.md', import.meta.url)), 'utf8');
  const cmds = PLAN.split('\n').filter((l) => l.startsWith('node ln-com-credenciais.mjs staging --'));

  it('todo comando traz caminhos com separadores (nada como "C:UsersmazinOpenBot…") e aponta para o carregador compilado', () => {
    expect(cmds.length).toBeGreaterThanOrEqual(8); // v3 (4) + v2 (4)
    for (const c of cmds) {
      expect(c).not.toMatch(/[A-Za-z]:[A-Za-z]/); // unidade seguida de letra = separador perdido
      expect(c).not.toMatch(/OpenBotShared|Sharedloyalty|\.cache[a-z]/);
      expect(c).toContain('/node_modules/.cache/ln-intelligence/load-seed.mjs');
      expect(c).toMatch(/--check$|--dataset C:\/Users\/mazin\/\S+seed\.public\.v[23]\.json --verification C:\/Users\/mazin\/\S+seed\.public\.v[23]\.verification\.json/);
    }
    const aplicar = cmds.filter((c) => c.includes('--apply'));
    expect(aplicar).toHaveLength(2);
    for (const c of aplicar) expect(c).toMatch(/--manifest C:\/Users\/mazin\/\S+\/releases\/staging\/intelligence-seed-v[23]\.manifest\.json$/);
  });

  it('o documento INTEIRO (não só os comandos) não tem caminho com separador perdido', () => {
    expect(PLAN).not.toMatch(/[A-Za-z]:[A-Za-z]/);
    expect(PLAN).not.toMatch(/OpenBotShared|Sharedloyalty|loyalty-newscode|codewt-/);
  });

  it('o texto do desfazer descreve a restauração que o código faz (relationsRevalidatedPrevious)', () => {
    expect(PLAN).toMatch(/relationsRevalidatedPrevious/);
    expect(PLAN).toMatch(/restaura a evidência e a data de validação anteriores/);
  });
});
