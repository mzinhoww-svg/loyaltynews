import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import * as s from '@ln/db/schema';
import { CATALOG } from './index';

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: typeof t.db;
let client: typeof t.client;

beforeAll(async () => {
  t = await createTestDb(); // migrações reais de @ln/db (inclui 0003_commercial)
  db = t.db; client = t.client;
  await db.insert(s.adFormats).values(CATALOG.map((f) => ({
    id: f.id, secao: f.section, nome: f.name, referenciaBrl: f.referenceText, escopo: f.scope,
    disponibilidade: f.status, motivoDisponibilidade: f.statusReason,
    precoTipo: f.priceType, precoValorBrl: f.fromBRL === null ? null : String(f.fromBRL), unidade: f.unit,
    taxaPct: f.feePct === null ? null : String(f.feePct), fonteLinha: f.sourceLine,
  })));
}, 60_000);
afterAll(async () => { await client.close(); });

// Exige a restrição nomeada: um erro qualquer (FK, tipo) não pode mascarar a regra testada.
const fails = async (p: Promise<unknown>, constraint: string) => {
  const err = await p.then(() => null, (e: unknown) => e as { message?: string; cause?: { message?: string; constraint?: string } });
  expect(err, 'esperava violação de ' + constraint).not.toBeNull();
  const txt = [err!.message, err!.cause?.message, err!.cause?.constraint].join(' | ');
  expect(txt).toContain(constraint);
};

describe('schema comercial de @ln/db (migrações reais, PGlite)', () => {
  it('carrega os 47 formatos do catálogo, nenhum disponível', async () => {
    expect(await db.$count(s.adFormats)).toBe(47);
    const r = await client.query<{ n: number }>("select count(*)::int n from ad_formats where disponibilidade = 'disponivel'");
    expect(r.rows[0]!.n).toBe(0);
  });
  it('recusa preço incoerente (verba sem taxa, fixo sem valor)', async () => {
    const base = { secao: 'x', nome: 'x', referenciaBrl: 'x', escopo: 'x', unidade: 'unidade' as const };
    await fails(db.insert(s.adFormats).values({ ...base, id: 'bad1', precoTipo: 'verba_mais_taxa', precoValorBrl: null, taxaPct: null }), 'ad_formats_preco_coerente');
    await fails(db.insert(s.adFormats).values({ ...base, id: 'bad2', precoTipo: 'fixo', precoValorBrl: null }), 'ad_formats_preco_coerente');
  });
  it('slot: posição única; limite positivo; reservável exige contrato mínimo', async () => {
    await db.insert(s.adSlots).values({ id: 'slot-top', posicao: 'TOP', formatoId: 'banners--banner-topo', dimensaoDesktop: '1280×150', limiteCotas: 4, pesoMaxKb: 200, contratoMinimoDias: 90 });
    await fails(db.insert(s.adSlots).values({ id: 'dup', posicao: 'TOP', formatoId: 'banners--banner-topo', dimensaoDesktop: 'x' }), 'ad_slots_posicao_uq');
    await fails(db.insert(s.adSlots).values({ id: 's0', posicao: 'FOOTER', formatoId: 'banners--banner-rodape', dimensaoDesktop: 'x', limiteCotas: 0 }), 'ad_slots_limite_positivo');
    await fails(db.insert(s.adSlots).values({ id: 's1', posicao: 'FOOTER', formatoId: 'banners--banner-rodape', dimensaoDesktop: 'x', limiteCotas: 6 }), 'ad_slots_reservavel_completo');
    await db.insert(s.adSlots).values({ id: 'slot-agenda', posicao: 'AGENDA', formatoId: 'banners--banner-na-agenda', dimensaoDesktop: 'parametrizavel' }); // não reservável, aceito
  });
  it('lead: opt-in nunca é default; classe sempre personal', async () => {
    await db.insert(s.crmLeads).values({ id: 'l1', nome: 'Ana', empresa: 'Acme', email: 'a@acme.com', objetivo: 'x', consentimentoEm: new Date() });
    const r = await client.query<{ opt_in_newsletter: boolean; classe_de_dado: string }>("select opt_in_newsletter, classe_de_dado from crm_leads where id='l1'");
    expect(r.rows[0]).toEqual({ opt_in_newsletter: false, classe_de_dado: 'personal' });
    await fails(db.insert(s.crmLeads).values({ id: 'l2', nome: 'B', empresa: 'B', email: 'b@b.com', objetivo: 'x', consentimentoEm: new Date(), classeDeDado: 'public' }), 'crm_leads_classe');
  });
  it('oportunidade: perdida exige motivo; valor nulo é aceito (não estimar), negativo não', async () => {
    await db.insert(s.crmAccounts).values({ id: 'acc1', nome: 'Acme' });
    await fails(db.insert(s.crmAccounts).values({ id: 'acc2', nome: 'ACME' }), 'crm_accounts_nome_uq'); // unicidade case-insensitive
    await db.insert(s.crmOpportunities).values({ id: 'o1', contaId: 'acc1', titulo: 't' });
    await fails(db.insert(s.crmOpportunities).values({ id: 'o2', contaId: 'acc1', titulo: 't', estagio: 'perdido' }), 'crm_opp_perda_exige_motivo');
    await db.insert(s.crmOpportunities).values({ id: 'o3', contaId: 'acc1', titulo: 't', estagio: 'perdido', motivoPerda: 'sem verba' });
    await fails(db.insert(s.crmOpportunities).values({ id: 'o4', contaId: 'acc1', titulo: 't', valorBrl: '-1' }), 'crm_opp_valor_nao_negativo');
  });
  it('campanha: período coerente e sempre rotulada; reserva com período coerente', async () => {
    const c = { contaId: 'acc1', formatoId: 'banners--banner-topo', nome: 'c' };
    await db.insert(s.campaigns).values({ ...c, id: 'c1', inicio: '2026-12-01', fim: '2027-02-28' });
    await fails(db.insert(s.campaigns).values({ ...c, id: 'c2', inicio: '2026-12-10', fim: '2026-12-01' }), 'campaigns_periodo');
    await fails(db.insert(s.campaigns).values({ ...c, id: 'c3', inicio: '2026-12-01', fim: '2026-12-31', rotulada: false }), 'campaigns_rotulada');
    await db.insert(s.adReservations).values({ id: 'r1', slotId: 'slot-top', contaId: 'acc1', campanhaId: 'c1', inicio: '2026-12-01', fim: '2027-02-28' });
    await fails(db.insert(s.adReservations).values({ id: 'r2', slotId: 'slot-top', contaId: 'acc1', inicio: '2026-12-10', fim: '2026-12-01' }), 'ad_reservations_periodo');
  });
  it('takeover: um por dia; criativo: peso>0 e destino https', async () => {
    await db.insert(s.adTakeovers).values({ id: 't1', dia: '2026-12-10', contaId: 'acc1' });
    await fails(db.insert(s.adTakeovers).values({ id: 't2', dia: '2026-12-10', contaId: 'acc1' }), 'ad_takeovers_dia_uq');
    const k = { campanhaId: 'c1', slotId: 'slot-top', inicio: '2026-12-01', fim: '2026-12-31' };
    await db.insert(s.adCreatives).values({ ...k, id: 'cr1', peso: 1, destinoUrl: 'https://anunciante.example/x' });
    await fails(db.insert(s.adCreatives).values({ ...k, id: 'cr2', peso: 0 }), 'ad_creatives_peso');
    await fails(db.insert(s.adCreatives).values({ ...k, id: 'cr3', destinoUrl: 'http://inseguro.example' }), 'ad_creatives_destino_https');
  });
  it('entrega diária: uma linha por criativo/dia; visíveis e cliques ≤ servidas; sem negativos', async () => {
    await db.insert(s.adDeliveryDaily).values({ id: 'd1', criativoId: 'cr1', dia: '2026-12-02', servidas: 10, visiveis: 8, cliques: 1 });
    await fails(db.insert(s.adDeliveryDaily).values({ id: 'd2', criativoId: 'cr1', dia: '2026-12-02' }), 'ad_delivery_daily_uq');
    await fails(db.insert(s.adDeliveryDaily).values({ id: 'd3', criativoId: 'cr1', dia: '2026-12-03', servidas: 1, visiveis: 2 }), 'ad_delivery_visivel_le_servida');
    await fails(db.insert(s.adDeliveryDaily).values({ id: 'd4', criativoId: 'cr1', dia: '2026-12-04', servidas: -1 }), 'ad_delivery_nao_negativo');
  });
  it('métrica disponível exige valor, período e horário; indisponível aceita nulos', async () => {
    await db.insert(s.commercialMetrics).values({ id: 'm0', origem: 'ga4_report', metrica: 'sessions_30d', status: 'unavailable', versaoMetodologia: 'mk-1' });
    await fails(db.insert(s.commercialMetrics).values({ id: 'm1', origem: 'cms', metrica: 'articles_30d', status: 'available', versaoMetodologia: 'mk-1' }), 'commercial_metrics_disponivel_completa');
    await db.insert(s.commercialMetrics).values({ id: 'm2', origem: 'cms', metrica: 'articles_30d', valor: '12', periodoInicio: new Date('2026-10-23'), periodoFim: new Date('2026-11-22'), coletadoEm: new Date(), status: 'available', versaoMetodologia: 'mk-1' });
    await fails(db.insert(s.commercialMetrics).values({ id: 'm3', origem: 'cms', metrica: 'articles_30d', status: 'unavailable', versaoMetodologia: 'mk-1' }), 'commercial_metrics_uq'); // última coleta única por origem/métrica
  });
});
