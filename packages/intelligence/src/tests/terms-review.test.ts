import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db';
import {
  getCompanyHandler, getExecutiveHandler, graphNeighborsHandler, listMovesHandler, loadSeed, portalCompanyPage, portalMovesPage, portalSearch,
  searchCompaniesHandler, type SeedDataset, type VerificationReport,
} from '../index';
import { newDb } from './helpers';

const file = (n: string) => fileURLToPath(new URL(`../../data/${n}`, import.meta.url));
const read = <T>(n: string): T => JSON.parse(readFileSync(file(n), 'utf8')) as T;
const SEED = read<SeedDataset>('seed.public.v2.json');
const SEED_VER = read<VerificationReport>('seed.public.v2.verification.json');
const TERMS = read<{ sources: { id: string }[]; termsFindings: { id: string; sourceId: string; tipo: string; quote: string }[] }>('terms.review.v1.json');
const TERMS_VER = read<VerificationReport>('terms.review.v1.verification.json');

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

describe('revisão J-14 dos termos das fontes', () => {
  it('todos os achados têm citação literal encontrada na página indicada', () => {
    expect(TERMS_VER.datasetId).toBe('terms.review.v1');
    expect(TERMS_VER.records).toHaveLength(TERMS.termsFindings.length);
    expect(TERMS_VER.records.every((r) => r.quote_found)).toBe(true);
    expect(TERMS_VER.sources.every((s) => s.status === 'verified' || s.status === 'partial')).toBe(true);
  });

  it('cada fonte do seed v2 está coberta por achado de termos ou por exceção explícita (documento de escopo diferente)', () => {
    const covered = new Set(TERMS.termsFindings.map((f) => f.sourceId));
    const exceptions: Record<string, string> = { 'bradesco-livelo': 'bradesco-app-termos' }; // hotsite sem aviso próprio; só os termos do aplicativo (escopo diferente) foram achados
    for (const s of SEED.sources) {
      expect(covered.has(s.id) || covered.has(exceptions[s.id] ?? '')).toBe(true);
    }
  });

  it('nenhuma página lida AUTORIZA expressamente o reuso (nenhum achado é permissão): o documento depende de decisão do proprietário', () => {
    expect(TERMS.termsFindings.every((f) => /^(reserva_geral|proibicao_)/.test(f.tipo))).toBe(true);
  });
});

describe('mitigação J-14: a exibição pública nunca reproduz o trecho citado', () => {
  it('portal e handlers públicos devolvem fato, fonte, link e data — não o trecho (excerpt) guardado como evidência', async () => {
    const { plan } = await loadSeed(db, SEED, SEED_VER);
    expect(plan.counts).toEqual({ create: 40, exists: 0, rejected: 0 });
    const liveloId = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE normalized_name = 'livelo'`)).rows[0]!.id;
    const abemfId = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE normalized_name LIKE 'abemf%'`)).rows[0]!.id;

    const outputs = [
      await portalCompanyPage(db, liveloId, '2026-12-01'),
      await portalCompanyPage(db, abemfId, '2026-12-01'),
      await portalMovesPage(db),
      await portalSearch(db, 'livelo'),
      (await getCompanyHandler(db, 'public', { id: liveloId, asOf: '2026-12-01' })).body,
      (await getCompanyHandler(db, 'studio', { id: liveloId, asOf: '2026-12-01', includeInferred: true })).body,
      (await searchCompaniesHandler(db, { q: 'a' })).body,
      (await listMovesHandler(db, 'studio', {})).body,
      (await graphNeighborsHandler(db, 'studio', { type: 'organization', id: liveloId, asOf: '2026-12-01' })).body,
      (await getExecutiveHandler(db, 'public', { id: '00000000-0000-4000-8000-000000000000' })).body,
    ];
    const text = JSON.stringify(outputs);
    // há dados reais na saída (controle) e, ainda assim, nenhuma citação literal
    expect(text).toContain('Livelo');
    expect(text).toContain('https://www.livelo.com.br/imprensa');
    const quotes = [...SEED.organizations, ...SEED.relations].map((r) => r.quote);
    for (const q of new Set(quotes)) expect(text.includes(q)).toBe(false);
    expect(text.includes('Empresas Associadas Conheça as empresas')).toBe(false);
    expect(text).not.toMatch(/"excerpt"/);
  });
});
