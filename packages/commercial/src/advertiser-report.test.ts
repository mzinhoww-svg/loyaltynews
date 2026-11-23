import { describe, expect, it } from 'vitest';
import { ApiError } from '@ln/contracts';
import {
  ADVERTISER_DAILY_CSV_COLUMNS, DeliveryAudit, buildAdvertiserReport, advertiserDailyCsv, advertiserSummaryCsv, advertiserCsv, createCommercialState, makeCtx,
  type AdvertiserReport, type Campaign, type Creative, type DeliveryRow,
} from './index';
import * as h from './api/index';
import { realContent } from './real-creative.mock';

const NOW = '2026-12-20T12:00:00-03:00';
const studio = { id: 'u', canManageCommercial: true };
const code = (r: h.HttpResult) => ApiError.parse(r.body).error.code;

const camp = (id: string, over: Partial<Campaign> = {}): Campaign => ({
  id, name: `Campanha ${id}`, accountId: 'acc-1', opportunityId: null, formatId: 'banners--banner-rodape', positionIds: ['FOOTER'], positionId: 'FOOTER',
  startDate: '2026-12-01', endDate: '2027-01-31', status: 'active', reservationIds: [], sponsoredLabel: true, history: [], ...over,
});
const cr = (id: string, campaignId: string, positionId = 'FOOTER'): Creative => ({ id, campaignId, positionId, weight: 1, startDate: '2026-12-01', endDate: '2027-01-31', approved: true, campaignActive: true, ...realContent(positionId) });
const row = (creativeId: string, day: string, served: number, visible: number, clicks: number, over: Partial<DeliveryRow> = {}): DeliveryRow =>
  ({ creativeId, day, served, visible, clicks, ignoredBotInternal: 0, refreshSuppressed: 0, updatedAt: `${day}T23:00:00-03:00`, ...over });

const A1 = camp('cmp-1');
const A2 = camp('cmp-2', { name: 'Segunda', positionIds: ['SIDEBAR_1'], positionId: 'SIDEBAR_1', startDate: '2026-12-10', endDate: '2027-02-28' });
const OTHER = camp('cmp-9', { accountId: 'acc-2', name: 'De outro anunciante' });
const CREATIVES = [cr('c1', 'cmp-1'), cr('c2', 'cmp-2', 'SIDEBAR_1'), cr('c9', 'cmp-9')];

const build = (delivery: DeliveryRow[], over: Partial<Parameters<typeof buildAdvertiserReport>[0]> = {}): AdvertiserReport =>
  buildAdvertiserReport({ account: { id: 'acc-1', name: 'Acme Fidelidade' }, campaigns: [A1, A2, OTHER], creatives: CREATIVES, reservations: [], delivery, audit: new DeliveryAudit(), now: NOW, ...over });

function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, ''); const rows: string[][] = []; let cur: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\r' && t[i + 1] === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; i++; } else cell += ch;
  }
  if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
  return rows;
}

describe('agregação das campanhas do anunciante', () => {
  const data = [
    row('c1', '2026-12-10', 100, 60, 3, { ignoredBotInternal: 5, refreshSuppressed: 2 }),
    row('c1', '2026-12-11', 50, 30, 1),
    row('c2', '2026-12-11', 40, 10, 0, { ignoredBotInternal: 1 }),
    row('c9', '2026-12-11', 999, 999, 999), // outro anunciante: nunca entra
  ];
  it('totais somados, por campanha, série por dia e fora-da-contagem', () => {
    const r = build(data);
    expect(r.advertiser).toEqual({ id: 'acc-1', name: 'Acme Fidelidade' });
    expect(r.totals).toEqual({ served: 190, visible: 100, clicks: 4, visibleRate: 0.526316, ctr: 0.021053 });
    expect(r.campaigns.map((c) => [c.id, c.totals?.served, c.totals?.visible, c.totals?.clicks])).toEqual([['cmp-1', 150, 90, 4], ['cmp-2', 40, 10, 0]]);
    expect(r.campaigns.map((c) => c.positions)).toEqual([['FOOTER'], ['SIDEBAR_1']]);
    expect(r.daily).toEqual([
      { day: '2026-12-10', served: 100, visible: 60, clicks: 3, visibleRate: 0.6, ctr: 0.03 },
      { day: '2026-12-11', served: 90, visible: 40, clicks: 1, visibleRate: 0.444444, ctr: 0.011111 },
    ]);
    expect(r.excluded).toEqual({ botOrInternal: 6, refreshSuppressed: 2 });
    expect(r.updatedAt).toBe('2026-12-11T23:00:00-03:00');
  });
  it('a soma das campanhas e a soma dos dias fecham com o total', () => {
    const r = build(data);
    expect(r.campaigns.reduce((t, c) => t + (c.totals?.served ?? 0), 0)).toBe(r.totals!.served);
    expect(r.daily.reduce((t, d) => t + d.visible, 0)).toBe(r.totals!.visible);
    expect(r.rows.reduce((t, x) => t + x.clicks, 0)).toBe(r.totals!.clicks);
  });
  it('só as campanhas DO anunciante: a de outra conta não entra nem na lista nem nos números', () => {
    const r = build(data);
    expect(r.campaigns.map((c) => c.id)).not.toContain('cmp-9');
    expect(r.rows.every((x) => x.campaignId !== 'cmp-9')).toBe(true);
    expect(JSON.stringify(r)).not.toContain('De outro anunciante');
  });
  it('campanha sem entrega fica na lista com total null (nunca zero); sem nenhuma entrega o total geral é null', () => {
    const r = build([row('c1', '2026-12-10', 10, 5, 1)]);
    expect(r.campaigns.find((c) => c.id === 'cmp-2')).toMatchObject({ totals: null, updatedAt: null });
    const vazio = build([]);
    expect(vazio.totals).toBeNull(); expect(vazio.excluded).toBeNull(); expect(vazio.updatedAt).toBeNull(); expect(vazio.window.effective).toBeNull();
    expect(vazio.emptyState).toBe('Sem entrega registrada na janela.');
    expect(vazio.campaigns.every((c) => c.totals === null)).toBe(true);
  });
  it('dias sem registro não viram zero; janela com dado é a dos registros', () => {
    const r = build(data);
    expect(r.daily.map((d) => d.day)).toEqual(['2026-12-10', '2026-12-11']);
    expect(r.window.effective).toEqual({ from: '2026-12-10', to: '2026-12-11' });
  });
  it('é determinístico e independe da ordem das linhas', () => {
    expect(build([...data].reverse())).toEqual(build(data));
  });
});

describe('janela', () => {
  const data = [row('c1', '2026-12-05', 10, 5, 1), row('c2', '2027-01-20', 30, 15, 3), row('c1', '2027-01-25', 20, 10, 2)];
  it('padrão: do menor início ao maior fim das campanhas dele', () => {
    expect(build(data).window).toMatchObject({ from: '2026-12-01', to: '2027-02-28' });
    expect(build(data).totals!.served).toBe(60);
  });
  it('janela pedida filtra e só lista as campanhas que a tocam', () => {
    const r = build(data, { window: { from: '2027-02-01', to: '2027-02-20' } });
    expect(r.campaigns.map((c) => c.id)).toEqual(['cmp-2']); // cmp-1 termina em 31/01
    expect(r.totals).toBeNull();
    const r2 = build(data, { window: { from: '2026-12-01', to: '2026-12-09' } });
    expect(r2.campaigns.map((c) => c.id)).toEqual(['cmp-1']); // cmp-2 só começa em 10/12
    expect(r2.totals).toMatchObject({ served: 10, visible: 5, clicks: 1 });
  });
  it('nenhuma campanha na janela: estado vazio explica', () => {
    expect(build(data, { window: { from: '2028-01-01', to: '2028-01-31' } }).emptyState).toBe('Nenhuma campanha do anunciante toca a janela.');
  });
  it('anunciante sem campanhas: janela de hoje e estado vazio honesto', () => {
    const r = build([], { campaigns: [OTHER] });
    expect(r.campaigns).toEqual([]); expect(r.totals).toBeNull();
    expect(r.window).toMatchObject({ from: '2026-12-20', to: '2026-12-20' });
    expect(r.emptyState).toBe('O anunciante ainda não tem campanhas.');
  });
  it('janela padrão com mais de 366 dias é limitada aos últimos 366 dias, com aviso', () => {
    const longa = camp('cmp-5', { startDate: '2024-01-01', endDate: '2026-12-31' });
    const r = build([], { campaigns: [longa] });
    expect(r.window).toMatchObject({ from: '2025-12-31', to: '2026-12-31' }); // 366 dias contando as duas pontas
    expect(r.notes.join(' ')).toMatch(/limitada aos últimos 366 dias/);
  });
  it('janela inválida é recusada: invertida, formato, data impossível, mais de 366 dias', () => {
    for (const w of [{ from: '2026-12-20', to: '2026-12-10' }, { from: '20/12/2026', to: '2026-12-31' }, { from: '2026-02-30', to: '2026-12-31' }, { from: '2025-01-01', to: '2026-12-31' }]) {
      expect(() => build(data, { window: w }), JSON.stringify(w)).toThrow(expect.objectContaining({ code: 'INVALID_WINDOW' }));
    }
  });
});

describe('integridade e auditabilidade', () => {
  it('linha inconsistente de uma campanha é descartada e listada com a campanha; as demais seguem', () => {
    const r = build([row('c1', '2026-12-10', 10, 5, 1), row('c1', '2026-12-11', 5, 9, 0), row('c2', '2026-12-11', 7, 3, 0)]);
    expect(r.totals).toMatchObject({ served: 17, visible: 8, clicks: 1 });
    expect(r.dataIssues).toEqual([{ creativeId: 'c1', day: '2026-12-11', reason: expect.stringMatching(/maiores que as servidas/), campaignId: 'cmp-1' }]);
    expect(r.notes.join(' ')).toMatch(/1 linha\(s\) de entrega com inconsistência/);
  });
  it('lacuna de dedupe na janela: não auditável, números mínimos', () => {
    const audit = new DeliveryAudit(); audit.reportLoss({ detectedAtMs: Date.parse('2026-12-10T09:00:00-03:00'), reason: 'dedupe_perdido' });
    const r = build([row('c1', '2026-12-10', 1, 1, 0)], { audit });
    expect(r.auditability).toMatchObject({ auditable: false, lowerBound: true });
    expect(r.notes.join(' ')).toMatch(/mínimos, não totais/);
    expect(build([row('c1', '2026-12-10', 1, 1, 0)]).auditability.auditable).toBe(true);
  });
  it('nunca estimado, sem preço, valor, fatura ou cobrança', () => {
    const r = build([row('c1', '2026-12-10', 10, 5, 1)]);
    expect(r.estimated).toBe(false);
    const keys: string[] = [];
    const walk = (v: unknown) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
    walk(r);
    expect(keys).toContain('estimated');
    for (const k of keys.filter((x) => x !== 'estimated')) expect(k, k).not.toMatch(/estim|price|preco|valor|amount|invoice|fatur|cobran|billing|receita|revenue|brl/i);
  });
  it('origem, definições e atualização presentes', () => {
    const r = build([row('c1', '2026-12-10', 10, 5, 1)]);
    expect(r.source.table).toBe('ad_delivery_daily'); expect(r.definitions.join(' ')).toMatch(/Nenhum número é estimado/);
    expect(build([], { campaigns: [] }).definitions.length).toBeGreaterThan(0); // mesmo sem campanhas, as definições vêm
  });
});

describe('CSV do anunciante', () => {
  const data = [row('c1', '2026-12-10', 100, 60, 3), row('c2', '2026-12-11', 0, 0, 0), row('c1', '2026-12-11', 10, 5, 0)];
  it('diário: BOM, CRLF, cabeçalho fixo, uma linha por campanha, criativo e dia COM registro', () => {
    const csv = advertiserDailyCsv(build(data));
    expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv.endsWith('\r\n')).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...ADVERTISER_DAILY_CSV_COLUMNS]);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r).toHaveLength(ADVERTISER_DAILY_CSV_COLUMNS.length);
    expect(rows[1]!.slice(0, 13)).toEqual(['acc-1', 'Acme Fidelidade', 'cmp-1', 'Campanha cmp-1', '2026-12-10', 'FOOTER', 'c1', '100', '60', '3', '0.6', '0.03', rows[1]![12]]);
    expect(rows[1]![14]).toBe('sim');
    const zero = rows.find((r) => r[6] === 'c2')!;
    expect(zero.slice(7, 12)).toEqual(['0', '0', '0', '', '']); // servida 0: taxas vazias
  });
  it('sem dado: só o cabeçalho', () => {
    expect(parseCsv(advertiserDailyCsv(build([])))).toEqual([[...ADVERTISER_DAILY_CSV_COLUMNS]]);
  });
  it('injeção de fórmula nos nomes (anunciante e campanha) e quebra de linha/aspas preservadas', () => {
    const evil = '=HYPERLINK("http://x","c")';
    const r = build([row('c1', '2026-12-10', 1, 1, 0)], { account: { id: 'acc-1', name: evil }, campaigns: [camp('cmp-1', { name: '+cmd' }), A2] });
    const [, a] = parseCsv(advertiserDailyCsv(r));
    expect(a![1]!.startsWith("'")).toBe(true); expect(a![3]!.startsWith("'")).toBe(true);
    const nome = 'Acme, "Fidelidade"\nLtda';
    const [, b] = parseCsv(advertiserDailyCsv(build([row('c1', '2026-12-10', 1, 1, 0)], { account: { id: 'acc-1', name: nome } })));
    expect(b![1]).toBe(nome);
  });
  it('resumo: campo,valor, linhas por campanha, estimado=nao, definições', () => {
    const rows = parseCsv(advertiserSummaryCsv(build(data)));
    const kv = new Map(rows.slice(1).filter((r) => r[0] !== 'definicao' && r[0] !== 'campanha').map((r) => [r[0]!, r[1]!]));
    expect(kv.get('anunciante')).toBe('Acme Fidelidade'); expect(kv.get('campanhas_na_janela')).toBe('2');
    expect(kv.get('impressoes_servidas')).toBe('110'); expect(kv.get('campanha_cmp-1_impressoes_servidas')).toBe('110'); expect(kv.get('campanha_cmp-2_impressoes_servidas')).toBe('0');
    expect(kv.get('estimado')).toBe('nao'); expect(kv.get('periodo_auditavel')).toBe('sim');
    expect(rows.filter((r) => r[0] === 'campanha').map((r) => r[1])).toEqual([
      'cmp-1 | Campanha cmp-1 | active | 2026-12-01 a 2027-01-31 | FOOTER', 'cmp-2 | Segunda | active | 2026-12-10 a 2027-02-28 | SIDEBAR_1',
    ]);
    expect(rows.filter((r) => r[0] === 'definicao').length).toBeGreaterThan(0);
  });
  it('resumo sem dado: totais vazios (não 0) e o motivo preenchido; campanha sem entrega vazia', () => {
    const kv = new Map(parseCsv(advertiserSummaryCsv(build([]))).slice(1).map((r) => [r[0]!, r[1]!]));
    for (const k of ['impressoes_servidas', 'impressoes_visiveis', 'cliques_validos', 'taxa_visibilidade', 'ctr', 'atualizado_em', 'campanha_cmp-1_impressoes_servidas']) expect(kv.get(k), k).toBe('');
    expect(kv.get('sem_dado')).toBe('Sem entrega registrada na janela.');
  });
  it('nome do arquivo saneado', () => {
    expect(advertiserCsv(build([]), 'diario').filename).toBe('relatorio-anunciante-diario-acc-1-2026-12-01-2027-02-28.csv');
    expect(advertiserCsv(build([], { account: { id: '../../x"y', name: 'A' }, campaigns: [] }), 'resumo').filename).toMatch(/^relatorio-anunciante-resumo-[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('handlers (Studio)', () => {
  function setup(delivery?: DeliveryRow[]) {
    const state = createCommercialState();
    const acc = state.crm.createAccount('Acme Fidelidade', NOW);
    const other = state.crm.createAccount('Outra Conta', NOW);
    const c1 = state.campaigns.create({ name: 'Rodapé', accountId: acc.id, formatId: 'banners--banner-rodape', positionIds: ['FOOTER'], startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    state.campaigns.create({ name: 'Alheia', accountId: other.id, formatId: 'banners--banner-rodape', positionIds: ['FOOTER'], startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    state.ads.addCreative({ ...cr('cr-1', c1.id) });
    return { state, acc, other, ctx: makeCtx(state, { now: NOW, today: '2026-12-20', flags: {}, actor: studio, delivery }) };
  }
  it('autenticação: 401 sem sessão e 403 sem permissão, nos dois', () => {
    const { state, acc } = setup();
    const anon = makeCtx(state, { now: NOW }); const leitor = makeCtx(state, { now: NOW, actor: { id: 'l', canManageCommercial: false } });
    for (const call of [h.getAdvertiserReport, h.exportAdvertiserReportCsv]) { expect(call(anon, { accountId: acc.id }).status).toBe(401); expect(call(leitor, { accountId: acc.id }).status).toBe(403); }
  });
  it('relatório pelo handler usa ctx.delivery e só as campanhas da conta', () => {
    const { ctx, acc } = setup([row('cr-1', '2026-12-10', 10, 6, 1)]);
    const body = h.getAdvertiserReport(ctx, { accountId: acc.id }).body as AdvertiserReport;
    expect(body.advertiser.name).toBe('Acme Fidelidade'); expect(body.campaigns).toHaveLength(1);
    expect(body.totals).toMatchObject({ served: 10, visible: 6, clicks: 1 });
  });
  it('sem ctx.delivery: "sem entrega registrada", nunca número inventado', () => {
    const { ctx, acc } = setup(undefined);
    const body = h.getAdvertiserReport(ctx, { accountId: acc.id }).body as AdvertiserReport;
    expect(body.totals).toBeNull(); expect(body.emptyState).toBe('Sem entrega registrada na janela.');
  });
  it('erros: 404 conta, 422 janela inválida, 400 parâmetro', () => {
    const { ctx, acc } = setup();
    const nf = h.getAdvertiserReport(ctx, { accountId: 'acc-404' });
    expect([nf.status, code(nf)]).toEqual([404, 'NOT_FOUND']);
    const bad = h.getAdvertiserReport(ctx, { accountId: acc.id, from: '2026-12-20', to: '2026-12-10' });
    expect([bad.status, code(bad)]).toEqual([422, 'INVALID_WINDOW']);
    expect(h.getAdvertiserReport(ctx, { accountId: acc.id, from: 'ontem' }).status).toBe(400);
    expect(h.getAdvertiserReport(ctx, {}).status).toBe(400);
    expect(h.exportAdvertiserReportCsv(ctx, { accountId: acc.id, kind: 'xlsx' }).status).toBe(400);
    expect(h.exportAdvertiserReportCsv(ctx, { accountId: 'acc-404' }).status).toBe(404);
  });
  it('CSV pelo handler: diário e resumo com nome e tipo de arquivo', () => {
    const { ctx, acc } = setup([row('cr-1', '2026-12-10', 10, 6, 1)]);
    const d = h.exportAdvertiserReportCsv(ctx, { accountId: acc.id }).body as { filename: string; contentType: string; csv: string };
    expect(d.filename).toBe('relatorio-anunciante-diario-acc-1-2026-12-01-2027-01-31.csv'); expect(d.contentType).toBe('text/csv; charset=utf-8');
    expect(parseCsv(d.csv)).toHaveLength(2);
    const s = h.exportAdvertiserReportCsv(ctx, { accountId: acc.id, kind: 'resumo' }).body as { csv: string };
    expect(parseCsv(s.csv)[0]).toEqual(['campo', 'valor']);
  });
  it('rotas na tabela: GET, só Studio', () => {
    for (const p of ['/api/commercial/studio/accounts/report', '/api/commercial/studio/accounts/report-csv']) expect(h.ROUTES.find((r) => r.path === p)).toMatchObject({ method: 'GET', auth: 'studio' });
  });
});
