import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';

// Estes testes exercitam o fluxo do lead: a rota pública só existe com a flag portalFormularios ligada (leads-flag.test.ts cobre os dois estados).
vi.mock('../../../lib/portal-formularios', () => ({ formulariosAtivos: () => true }));

// DP-43 por ambiente: aprovar criativo e levar campanha a approved/active pela API só vale onde a venda foi liberada (staging);
// em produção é 409 SALE_DISABLED_IN_ENV (venda-ambiente.test.ts). Este arquivo exercita o fluxo de venda, então roda como staging.
const APP_ENV_ANTES = process.env.APP_ENV;
beforeAll(() => { process.env.APP_ENV = 'staging'; });
afterAll(() => { if (APP_ENV_ANTES === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = APP_ENV_ANTES; });


let app: Awaited<ReturnType<typeof makeApp>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;

const P = (p: string) => `/api/commercial${p}`;
const lead = (over: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza', empresa: 'Programa Alfa', email: 'Ana@Alfa.example', formatosInteresse: ['banners--banner-topo'], objetivo: 'awareness',
  optInNewsletter: false, ...over,
});

beforeAll(async () => {
  app = await makeApp();
  comercial = await app.actor('comercial');
  admin = await app.actor('admin');
  editor = await app.actor('editor');
  leitor = await app.actor('leitor');
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('rotas públicas', () => {
  it('mídia kit e formatos respondem sem login; catálogo vem do código com estado do banco', async () => {
    const f = await call(d, 'GET', { path: P('/formats') });
    expect(f.status).toBe(200);
    expect(JSON.stringify(f.body)).toContain('banners--banner-topo');
    expect((await call(d, 'GET', { path: P('/mediakit') })).status).toBe(200);
    const av = await call(d, 'GET', { path: P('/availability'), query: { positionId: 'TOP', from: '2026-12-01', to: '2026-12-31' } });
    expect(av.status).toBe(200);
    expect(av.body).toMatchObject({ slotLimit: 4, peakUsed: 0 });
  });

  it('lead do mídia kit: grava como dado pessoal, e-mail normalizado, opt-in nunca marcado por padrão, resposta mínima', async () => {
    const r = await call(d, 'POST', { path: P('/leads'), body: lead() });
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(['consentimentoEm', 'id', 'status']);
    const [row] = await app.db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, r.body.id));
    expect(row).toMatchObject({ email: 'ana@alfa.example', classeDeDado: 'personal', optInNewsletter: false, status: 'novo' });
    expect((await call(d, 'POST', { path: P('/leads'), body: lead({ email: 'não-é-email' }) })).status).toBe(400);
    expect((await call(d, 'POST', { path: P('/leads'), body: lead({ campoExtra: 1 }) })).status).toBe(400);
  });

  it('rota inexistente 404; método errado 405; ad server desligado serve house e não grava entrega', async () => {
    expect((await call(d, 'GET', { path: P('/nada') })).status).toBe(404);
    expect((await call(d, 'GET', { path: P('/leads') })).status).toBe(405);
    const s = await call(d, 'POST', { path: P('/ads/serve'), body: { positionId: 'TOP', pageViewId: 'pv-1' } });
    expect(s.body).toMatchObject({ kind: 'house', counted: false });
    expect(await app.db.$count(schema.adDeliveryDaily)).toBe(0);
  });

  it('limite de formulário por IP (com proxy confiável configurado): 5 por 15 min', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    try {
      const rs = [];
      for (let i = 0; i < 7; i++) rs.push((await call(d, 'POST', { path: P('/leads'), body: lead({ email: `lim${i}@x.example` }) })).status);
      expect(rs.filter((s) => s === 201).length).toBe(5);
      expect(rs.filter((s) => s === 429).length).toBe(2);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });
});

describe('Studio: sessão, MFA e canManageCommercial vindo do RBAC', () => {
  it('sem sessão 401; editor 403 (sem permissão); leitor entra e o handler nega 403; comercial e admin 200', async () => {
    const path = P('/studio/dashboard');
    const query = { from: '2026-11-01', to: '2026-11-30' };
    expect((await call(d, 'GET', { path, query })).status).toBe(401);
    expect((await call(d, 'GET', { path, query, as: editor })).status).toBe(403);
    const l = await call(d, 'GET', { path, query, as: leitor });
    expect(l.status).toBe(403);
    expect(l.body.error.code).toBe('FORBIDDEN');
    expect((await call(d, 'GET', { path, query, as: comercial })).status).toBe(200);
    expect((await call(d, 'GET', { path, query, as: admin })).status).toBe(200);
    expect((await call(d, 'POST', { path: P('/studio/leads/qualify'), body: { leadId: 'lead-1' }, as: leitor })).status).toBe(403);
    const solo = await app.passwordOnly('comercial');
    expect((await call(d, 'GET', { path, query, as: solo })).body.error.code).toBe('MFA_REQUIRED');
  });
});

describe('fluxo comercial persistido no banco entre requisições', () => {
  let accountId = '';
  let oppId = '';

  it('qualifica, converte (conta reaproveitada por empresa) e ids novos não colidem após reidratar', async () => {
    const leads = await app.db.select().from(schema.crmLeads);
    const first = leads.find((l) => l.empresa === 'Programa Alfa')!;
    const q = await call(d, 'POST', { path: P('/studio/leads/qualify'), body: { leadId: first.id }, as: comercial });
    expect(q.body.status).toBe('qualificado');
    const c = await call(d, 'POST', { path: P('/studio/leads/convert'), body: { leadId: first.id }, as: comercial });
    expect(c.status).toBe(201);
    accountId = c.body.account.id;
    oppId = c.body.opportunity.id;
    expect(c.body.opportunity.stage).toBe('novo');
    // segunda conversão da mesma empresa reaproveita a conta
    const second = leads.find((l) => l.id !== first.id && l.empresa === 'Programa Alfa')!;
    const c2 = await call(d, 'POST', { path: P('/studio/leads/convert'), body: { leadId: second.id }, as: comercial });
    expect(c2.body.account.id).toBe(accountId);
    expect(c2.body.opportunity.id).not.toBe(oppId);
    expect(await app.db.$count(schema.crmAccounts)).toBe(1);
    const ids = [...(await app.db.select().from(schema.crmOpportunities))].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const inbox = await call(d, 'GET', { path: P('/studio/leads'), query: { status: 'convertido' }, as: comercial });
    expect(JSON.stringify(inbox.body)).toContain(first.id);
  });

  it('oportunidade: estágios válidos, histórico, motivo de perda e valor só quando informado', async () => {
    const mv = (to: string, extra: Record<string, unknown> = {}) =>
      call(d, 'POST', { path: P('/studio/opportunities/stage'), body: { opportunityId: oppId, to, ...extra }, as: comercial });
    expect((await mv('ganho')).body.error.code).toBe('BAD_STAGE');
    expect((await mv('qualificado')).status).toBe(200);
    const p = await mv('proposta', { amountBRL: 12500.5, nextAction: 'enviar proposta', nextActionDue: '2026-12-05' });
    expect(p.body).toMatchObject({ stage: 'proposta', amountBRL: 12500.5, proposalVersions: 1 });
    const [row] = await app.db.select().from(schema.crmOpportunities).where(eq(schema.crmOpportunities.id, oppId));
    expect(row).toMatchObject({ estagio: 'proposta', valorBrl: '12500.50', versoesProposta: 1, proximaAcaoPrazo: '2026-12-05' });
    const hist = await app.db.select().from(schema.crmOpportunityHistory).where(eq(schema.crmOpportunityHistory.oportunidadeId, oppId));
    expect(hist.map((h) => h.para).sort()).toEqual(['novo', 'proposta', 'qualificado']);
    const lost = await mv('perdido');
    expect(lost.status).toBe(422);
    expect(lost.body.error.code).toBe('LOST_REASON_REQUIRED');
    const board = await call(d, 'GET', { path: P('/studio/opportunities'), as: comercial });
    expect(board.status).toBe(200);
  });

  it('reserva: formato indisponível recusa; com estado ajustado no banco aceita pré-reserva; confirmar exige flag; cotas e concorrência', async () => {
    const res = (n: number) =>
      call(d, 'POST', { path: P('/studio/reservations'), body: { positionId: 'TOP', accountId, startDate: '2026-12-01', endDate: '2027-03-01' }, as: comercial }).then((r) => ({ ...r, n }));
    // o estado de disponibilidade vem do banco (ajustável no admin); semeia a tabela e marca indisponível
    await call(d, 'POST', { path: P('/studio/leads/discard'), body: { leadId: 'lead-1' }, as: comercial }); // qualquer escrita semeia ad_formats/ad_slots
    await app.db.update(schema.adFormats).set({ disponibilidade: 'indisponivel', motivoDisponibilidade: 'Teste: indisponível.' }).where(eq(schema.adFormats.id, 'banners--banner-topo'));
    const blocked = await res(0);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('FORMAT_UNAVAILABLE');
    await app.db.update(schema.adFormats).set({ disponibilidade: 'sob_consulta', motivoDisponibilidade: 'Teste: sob consulta.' }).where(eq(schema.adFormats.id, 'banners--banner-topo'));
    const conf = await call(d, 'POST', { path: P('/studio/reservations'), body: { positionId: 'TOP', accountId, startDate: '2026-12-01', endDate: '2027-03-01', confirm: true }, as: comercial });
    expect(conf.body.error.code).toBe('SALE_NOT_ENABLED');
    const short = await call(d, 'POST', { path: P('/studio/reservations'), body: { positionId: 'TOP', accountId, startDate: '2026-12-01', endDate: '2026-12-10' }, as: comercial });
    expect(short.body.error.code).toBe('MIN_CONTRACT');
    const nc = await call(d, 'POST', { path: P('/studio/reservations'), body: { positionId: 'ARTICLE_INLINE', accountId, startDate: '2026-12-01', endDate: '2027-03-01' }, as: comercial });
    expect(['POSITION_NOT_CONFIGURED', 'FORMAT_UNAVAILABLE']).toContain(nc.body.error.code);

    // 8 pedidos simultâneos para 4 cotas do TOP: exatamente 4 entram; o lock serializa as escritas
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => res(i)));
    expect(rs.filter((r) => r.status === 201).length).toBe(4);
    expect(rs.filter((r) => r.body.error?.code === 'NO_SLOT').length).toBe(4);
    const rows = await app.db.select().from(schema.adReservations);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
    const av = await call(d, 'GET', { path: P('/availability'), query: { positionId: 'TOP', from: '2026-12-01', to: '2026-12-31' } });
    expect(av.body).toMatchObject({ peakUsed: 4, free: 0 });
  });

  it('campanha: cria, reserva com reservas próprias, ativação recusada sem flag/evidência, criativo, rótulo sempre ligado', async () => {
    const mk = await call(d, 'POST', {
      path: P('/studio/campaigns'),
      body: { name: 'Campanha Alfa', accountId, formatId: 'banners--banner-topo', positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-03-01' },
      as: comercial,
    });
    expect(mk.status).toBe(201);
    const cid = mk.body.id as string;
    const [row] = await app.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, cid));
    expect(row).toMatchObject({ status: 'draft', rotulada: true, slotId: 'TOP', formatoId: 'banners--banner-topo' });
    expect((await call(d, 'POST', { path: P('/studio/campaigns'), body: { name: 'X', accountId: 'acc-inexistente', formatId: 'banners--banner-topo', startDate: '2026-12-01', endDate: '2027-03-01' }, as: comercial })).body.error.code).toBe('UNKNOWN_ACCOUNT');

    const noRes = await call(d, 'POST', { path: P('/studio/campaigns/transition'), body: { campaignId: cid, to: 'reserved', reservationIds: [] }, as: comercial });
    expect(noRes.status).toBe(422);
    const foreign = await app.db.select().from(schema.adReservations);
    const bad = await call(d, 'POST', { path: P('/studio/campaigns/transition'), body: { campaignId: cid, to: 'reserved', reservationIds: [foreign[0]!.id] }, as: comercial });
    expect(bad.body.error.code).toBe('INVALID_RESERVATION'); // reserva de outra campanha (sem vínculo)

    // criativo SEM arquivo/alt/destino não é real: aprovar é recusado com a lista do que falta, e o banco também o recusa (CHECK ad_creatives_aprovado_completo)
    const vazio = await call(d, 'POST', { path: P('/studio/creatives'), body: { campaignId: cid, positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-03-01' }, as: comercial });
    expect(vazio.status).toBe(201);
    const recusada = await call(d, 'POST', { path: P('/studio/creatives/approve'), body: { creativeId: vazio.body.id }, as: admin }); // DP-43: aprova o proprietário (admin)
    expect([recusada.status, recusada.body.error?.code]).toEqual([422, 'CREATIVE_INVALID']);
    // criativo REAL: arquivo (1280x150 PNG ≤ 200 KB, hash), texto alternativo, anunciante e destino https
    const real = { asset: { key: `anuncios/${'b'.repeat(64)}.png`, mime: 'image/png', width: 1280, height: 150, sizeKB: 90, sha256: 'b'.repeat(64) }, altText: 'Oferta do anunciante', destinationUrl: 'https://anunciante.example/oferta', advertiserName: 'Anunciante Teste' };
    const cr = await call(d, 'POST', { path: P('/studio/creatives'), body: { campaignId: cid, positionId: 'TOP', startDate: '2026-12-01', endDate: '2027-03-01', ...real }, as: comercial });
    expect(cr.status).toBe(201);
    // DP-43: o comercial prepara e envia, mas NÃO aprova (pela rota, não só pela tela); editor e leitor também não
    for (const quem of [comercial, editor]) {
      const r = await call(d, 'POST', { path: P('/studio/creatives/approve'), body: { creativeId: cr.body.id }, as: quem });
      expect([r.status, r.body.error?.code]).toEqual(quem === comercial ? [403, 'APPROVAL_FORBIDDEN'] : [403, 'FORBIDDEN']);
    }
    expect((await call(d, 'POST', { path: P('/studio/creatives/approve'), body: { creativeId: cr.body.id }, as: leitor })).status).toBe(403);
    expect((await call(d, 'POST', { path: P('/studio/creatives/approve'), body: { creativeId: cr.body.id } })).status).toBeGreaterThanOrEqual(401);
    const [antes] = await app.db.select().from(schema.adCreatives).where(eq(schema.adCreatives.id, cr.body.id));
    expect(antes).toMatchObject({ aprovado: false }); // nada mudou no banco
    const aprovaCampanha = await call(d, 'POST', { path: P('/studio/campaigns/transition'), body: { campaignId: cid, to: 'approved' }, as: comercial });
    expect([aprovaCampanha.status, aprovaCampanha.body.error?.code]).toEqual([403, 'APPROVAL_FORBIDDEN']);
    expect((await call(d, 'POST', { path: P('/studio/creatives/approve'), body: { creativeId: cr.body.id }, as: admin })).body).toMatchObject({ approved: true });
    expect((await call(d, 'POST', { path: P('/studio/creatives/approve'), body: { creativeId: 'cr-999' }, as: admin })).status).toBe(404);
    const [crRow] = await app.db.select().from(schema.adCreatives).where(eq(schema.adCreatives.id, cr.body.id));
    expect(crRow).toMatchObject({ aprovado: true, campanhaId: cid, slotId: 'TOP', peso: 1 });

    const draftToActive = await call(d, 'POST', { path: P('/studio/campaigns/transition'), body: { campaignId: cid, to: 'active' }, as: comercial });
    expect(draftToActive.body.error.code).toBe('BAD_TRANSITION');
    const detail = await call(d, 'GET', { path: P('/studio/campaigns/detail'), query: { campaignId: cid }, as: comercial });
    expect(detail.status).toBe(200);
    expect((await call(d, 'GET', { path: P('/studio/campaigns/detail'), query: { campaignId: 'cmp-999' }, as: comercial })).status).toBeGreaterThanOrEqual(400);
  });

  it('cancelar reserva persiste; inexistente 404; métrica real exige origem/período/horário e vira linha única', async () => {
    const [r] = await app.db.select().from(schema.adReservations).limit(1);
    const c = await call(d, 'POST', { path: P('/studio/reservations/cancel'), body: { reservationId: r!.id }, as: comercial });
    expect(c.body).toEqual({ id: r!.id, status: 'cancelled' });
    expect((await app.db.select().from(schema.adReservations).where(eq(schema.adReservations.id, r!.id)))[0]?.status).toBe('cancelled');
    expect((await call(d, 'POST', { path: P('/studio/reservations/cancel'), body: { reservationId: 'res-999' }, as: comercial })).status).toBe(404);

    const m = { source: 'ga4', metric: 'sessoes', value: 1234, period_start: '2026-11-01T00:00:00-03:00', period_end: '2026-11-30T23:59:59-03:00', fetched_at: '2026-11-22T09:00:00-03:00' };
    expect((await call(d, 'POST', { path: P('/studio/metrics'), body: { ...m, fetched_at: undefined }, as: comercial })).status).toBe(400);
    expect((await call(d, 'POST', { path: P('/studio/metrics'), body: m, as: comercial })).status).toBe(201);
    expect((await call(d, 'POST', { path: P('/studio/metrics'), body: { ...m, value: 2000 }, as: comercial })).status).toBe(201);
    const rows = await app.db.select().from(schema.commercialMetrics);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origem: 'ga4', metrica: 'sessoes', status: 'available' });
    expect(Number(rows[0]!.valor)).toBe(2000);
    expect(JSON.stringify((await call(d, 'GET', { path: P('/studio/dashboard'), query: { from: '2026-11-01', to: '2026-11-30' }, as: admin })).body)).toContain('sessoes');
  });

  it('escritas de Studio são auditadas com ator e papel', async () => {
    const rows = await app.db.select().from(schema.auditLog).where(eq(schema.auditLog.resource, 'comercial'));
    expect(rows.length).toBeGreaterThan(5);
    // o comercial prepara; a aprovação de imagem e campanha é do proprietário (admin, DP-43) e também fica auditada com o papel dele
    expect(rows.every((r) => r.actorRole === 'comercial' || r.actorRole === 'admin')).toBe(true);
    expect(rows.some((r) => r.actorRole === 'admin')).toBe(true);
    expect(rows.filter((r) => r.actorRole === 'comercial').length).toBeGreaterThan(5);
  });
});
