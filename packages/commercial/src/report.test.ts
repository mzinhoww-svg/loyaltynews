import { describe, expect, it } from 'vitest';
import {
  DAILY_CSV_COLUMNS, DeliveryAudit, ReportError, buildCampaignReport, createCommercialState, csvCell, makeCtx, reportCsv, reportDailyCsv, reportSummaryCsv,
  type Campaign, type CampaignReport, type Creative, type DeliveryRow, type Reservation,
} from './index';
import * as h from './api/index';
import { realContent } from './real-creative.mock';

const NOW = '2026-12-20T12:00:00-03:00';
const studio = { id: 'u', canManageCommercial: true };

const camp = (over: Partial<Campaign> = {}): Campaign => ({
  id: 'cmp-1', name: 'Acme Rodapé', accountId: 'acc-1', opportunityId: null, formatId: 'banners--banner-rodape', positionId: 'FOOTER',
  startDate: '2026-12-01', endDate: '2027-01-31', status: 'active', reservationIds: [], sponsoredLabel: true, history: [], ...over,
});
const cr = (id: string, positionId = 'FOOTER', over: Partial<Creative> = {}): Creative => ({
  id, campaignId: 'cmp-1', positionId, weight: 1, startDate: '2026-12-01', endDate: '2027-01-31', approved: true, campaignActive: true, ...realContent(positionId), ...over,
});
const res = (id: string, positionId = 'FOOTER', over: Partial<Reservation> = {}): Reservation => ({ id, positionId, advertiserId: 'acc-1', campaignId: 'cmp-1', startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed', ...over });
const row = (creativeId: string, day: string, served: number, visible: number, clicks: number, over: Partial<DeliveryRow> = {}): DeliveryRow =>
  ({ creativeId, day, served, visible, clicks, ignoredBotInternal: 0, refreshSuppressed: 0, updatedAt: `${day}T23:00:00-03:00`, ...over });

const build = (delivery: DeliveryRow[], over: Partial<Parameters<typeof buildCampaignReport>[0]> = {}): CampaignReport =>
  buildCampaignReport({ campaign: camp(), advertiserName: 'Acme Fidelidade', creatives: [cr('c1'), cr('c2', 'SIDEBAR_1')], reservations: [res('r1')], delivery, audit: new DeliveryAudit(), now: NOW, ...over });

/** Parser CSV mínimo (aspas duplas, vírgula, CRLF) para provar que o arquivo é estruturalmente válido. */
function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let cur: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\r' && t[i + 1] === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell !== '' || cur.length) { cur.push(cell); rows.push(cur); }
  return rows;
}

describe('cabeçalho: anunciante, período, posições e criativos aprovados', () => {
  it('traz anunciante, período e a campanha', () => {
    const r = build([]);
    expect(r.advertiser).toEqual({ id: 'acc-1', name: 'Acme Fidelidade' });
    expect(r.campaign).toMatchObject({ id: 'cmp-1', name: 'Acme Rodapé', startDate: '2026-12-01', endDate: '2027-01-31', status: 'active' });
  });
  it('posições = posição da campanha + dos criativos + das reservas não canceladas; reserva cancelada não conta', () => {
    const r = build([], { reservations: [res('r1'), res('r2', 'TOP'), res('r3', 'SIDEBAR_2', { status: 'cancelled' }), res('rx', 'DATA', { campaignId: 'cmp-9' })] });
    expect(r.positions.map((p) => p.positionId)).toEqual(['FOOTER', 'SIDEBAR_1', 'TOP']);
    expect(r.positions.find((p) => p.positionId === 'FOOTER')).toMatchObject({ name: 'Banner rodapé', dimension: '1280x200', approvedCreatives: 1 });
    expect(r.positions.find((p) => p.positionId === 'TOP')!.reservations).toEqual([{ id: 'r2', startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed' }]);
  });
  it('só criativos APROVADOS entram na lista; os pendentes são só contados; criativo de outra campanha é ignorado', () => {
    const r = build([], { creatives: [cr('c1'), cr('c2', 'FOOTER', { approved: false }), cr('c3', 'FOOTER', { campaignId: 'cmp-9' })] });
    expect(r.approvedCreatives.map((c) => c.id)).toEqual(['c1']);
    expect(r.approvedCreatives[0]).toMatchObject({ positionId: 'FOOTER', width: 1280, height: 200, altText: 'Anúncio de teste' });
    expect(r.pendingCreatives).toBe(1);
  });
  it('anunciante desconhecido fica null (não inventa nome)', () => {
    expect(build([], { advertiserName: null }).advertiser.name).toBeNull();
  });
});

describe('números: só o que foi contado', () => {
  const data = [
    row('c1', '2026-12-10', 100, 60, 3, { ignoredBotInternal: 7, refreshSuppressed: 5 }),
    row('c1', '2026-12-11', 50, 30, 1, { ignoredBotInternal: 2, refreshSuppressed: 1 }),
    row('c2', '2026-12-11', 40, 10, 0),
  ];
  it('totais, taxas, série por dia, por criativo e por posição', () => {
    const r = build(data);
    expect(r.totals).toEqual({ served: 190, visible: 100, clicks: 4, visibleRate: 0.526316, ctr: 0.021053 });
    expect(r.daily).toEqual([
      { day: '2026-12-10', served: 100, visible: 60, clicks: 3, visibleRate: 0.6, ctr: 0.03 },
      { day: '2026-12-11', served: 90, visible: 40, clicks: 1, visibleRate: 0.444444, ctr: 0.011111 },
    ]);
    expect(r.byCreative.map((c) => [c.creativeId, c.positionId, c.served, c.visible, c.clicks])).toEqual([['c1', 'FOOTER', 150, 90, 4], ['c2', 'SIDEBAR_1', 40, 10, 0]]);
    expect(r.byPosition.map((p) => [p.positionId, p.served, p.visible, p.clicks])).toEqual([['FOOTER', 150, 90, 4], ['SIDEBAR_1', 40, 10, 0]]);
    expect(r.excluded).toEqual({ botOrInternal: 9, refreshSuppressed: 6 });
  });
  it('a soma das partes é igual ao total (dia, criativo e posição)', () => {
    const r = build(data);
    for (const parts of [r.daily, r.byCreative, r.byPosition]) {
      expect(parts.reduce((t, p) => t + p.served, 0)).toBe(r.totals!.served);
      expect(parts.reduce((t, p) => t + p.visible, 0)).toBe(r.totals!.visible);
      expect(parts.reduce((t, p) => t + p.clicks, 0)).toBe(r.totals!.clicks);
    }
  });
  it('dias sem registro NÃO viram zero: ficam fora da série; janela com dado é a dos registros', () => {
    const r = build(data);
    expect(r.daily.map((d) => d.day)).toEqual(['2026-12-10', '2026-12-11']);
    expect(r.window).toEqual({ from: '2026-12-01', to: '2027-01-31', effective: { from: '2026-12-10', to: '2026-12-11' } });
  });
  it('sem nenhuma linha: totais null, taxas null, sem séries e estado vazio honesto (nunca zero)', () => {
    const r = build([]);
    expect(r.totals).toBeNull(); expect(r.excluded).toBeNull(); expect(r.updatedAt).toBeNull(); expect(r.window.effective).toBeNull();
    expect(r.daily).toEqual([]); expect(r.byCreative).toEqual([]); expect(r.rows).toEqual([]);
    expect(r.emptyState).toBe('Sem entrega registrada na janela.');
  });
  it('campanha ainda não ativada: o estado vazio diz isso', () => {
    for (const status of ['draft', 'reserved', 'approved'] as const) expect(build([], { campaign: camp({ status }) }).emptyState).toMatch(/ainda não foi ativada/);
  });
  it('linha com zero real conta como dado real (0 impressões visíveis medidas é 0, não "—")', () => {
    const r = build([row('c1', '2026-12-10', 10, 0, 0)]);
    expect(r.totals).toEqual({ served: 10, visible: 0, clicks: 0, visibleRate: 0, ctr: 0 });
  });
  it('servida 0 com linha existente: taxas null (não divide por zero, não inventa 0%)', () => {
    const r = build([row('c1', '2026-12-10', 0, 0, 0, { ignoredBotInternal: 4 })]);
    expect(r.totals).toMatchObject({ served: 0, visibleRate: null, ctr: null });
    expect(r.excluded).toEqual({ botOrInternal: 4, refreshSuppressed: 0 });
  });
  it('data do dado: a atualização mais recente entre as linhas contadas', () => {
    const r = build([row('c1', '2026-12-10', 1, 1, 0, { updatedAt: '2026-12-10T23:00:00-03:00' }), row('c1', '2026-12-11', 1, 1, 0, { updatedAt: '2026-12-12T01:30:00-03:00' })]);
    expect(r.updatedAt).toBe('2026-12-12T01:30:00-03:00');
  });
  it('origem declarada e definições presentes; metodologia versionada', () => {
    const r = build(data);
    expect(r.source.table).toBe('ad_delivery_daily'); expect(r.source.name).toMatch(/Servidor de anúncios/);
    expect(r.methodologyVersion).toBe('rel-1');
    expect(r.definitions.join(' ')).toMatch(/50% da área/); expect(r.definitions.join(' ')).toMatch(/Nenhum número é estimado/);
  });
  it('é determinístico e não depende da ordem das linhas', () => {
    const a = build(data); const b = build([...data].reverse());
    expect(b).toEqual(a);
  });
});

describe('nunca estimado, nunca cobrança', () => {
  it('estimated é literalmente false e nenhum campo fala em estimativa, preço, valor, fatura ou cobrança', () => {
    const r = build([row('c1', '2026-12-10', 10, 5, 1)]);
    expect(r.estimated).toBe(false);
    const keys: string[] = [];
    const walk = (v: unknown) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
    walk(r);
    expect(keys).toContain('estimated'); // o campo existe justamente para declarar false
    for (const k of keys.filter((x) => x !== 'estimated')) expect(k, k).not.toMatch(/estim|price|preco|valor|amount|invoice|fatur|cobran|billing|receita|revenue|brl/i);
  });
  it('não completa nem extrapola: um dia de dados não vira projeção para a janela', () => {
    const r = build([row('c1', '2026-12-10', 10, 5, 1)]);
    expect(r.totals).toMatchObject({ served: 10, visible: 5, clicks: 1 });
    expect(r.daily).toHaveLength(1);
  });
});

describe('janela', () => {
  const data = [row('c1', '2026-12-05', 10, 5, 1), row('c1', '2026-12-15', 20, 10, 2), row('c1', '2027-01-20', 30, 15, 3)];
  it('padrão é o período da campanha; a janela pedida filtra as linhas', () => {
    expect(build(data).totals!.served).toBe(60);
    const r = build(data, { window: { from: '2026-12-10', to: '2026-12-31' } });
    expect(r.window.from).toBe('2026-12-10'); expect(r.totals).toMatchObject({ served: 20, visible: 10, clicks: 2 });
  });
  it('a janela é recortada ao período da campanha (fora dela não há o que reportar)', () => {
    const r = build(data, { window: { from: '2026-11-01', to: '2027-03-01' } });
    expect(r.window).toMatchObject({ from: '2026-12-01', to: '2027-01-31' });
  });
  it('linhas fora da janela não entram nos números', () => {
    expect(build(data, { window: { from: '2026-12-14', to: '2026-12-16' } }).totals!.served).toBe(20);
  });
  it('janela inválida é recusada: invertida, formato ruim, fora do período, maior que 366 dias', () => {
    for (const w of [{ from: '2026-12-20', to: '2026-12-10' }, { from: '12/10/2026', to: '2026-12-20' }, { from: '2026-02-30', to: '2026-12-20' }, { from: '2027-02-01', to: '2027-02-28' }]) {
      expect(() => build(data, { window: w }), JSON.stringify(w)).toThrow(ReportError);
    }
    expect(() => build(data, { campaign: camp({ startDate: '2025-01-01', endDate: '2026-12-31' }) })).toThrow(/366/);
  });
  it('linhas de criativos de OUTRA campanha nunca entram', () => {
    const r = build([...data, row('c9', '2026-12-15', 999, 999, 999)]);
    expect(r.totals!.served).toBe(60);
  });
});

describe('linhas inconsistentes são descartadas e listadas', () => {
  const ok = row('c1', '2026-12-10', 10, 5, 1);
  const bad: [string, DeliveryRow][] = [
    ['negativo', row('c1', '2026-12-11', -1, 0, 0)],
    ['não inteiro', row('c1', '2026-12-12', 1.5, 1, 0)],
    ['visíveis > servidas', row('c1', '2026-12-13', 5, 6, 0)],
    ['cliques > servidas', row('c1', '2026-12-14', 5, 5, 6)],
    ['dia inválido', row('c1', '2026-13-40', 5, 5, 1)],
    ['atualização inválida', row('c1', '2026-12-15', 5, 5, 1, { updatedAt: 'ontem' })],
  ];
  it.each(bad)('%s: não entra nos números e aparece em dataIssues', (_n, b) => {
    const r = build([ok, b]);
    expect(r.totals).toMatchObject({ served: 10, visible: 5, clicks: 1 });
    expect(r.dataIssues).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/1 linha\(s\) de entrega com inconsistência/);
  });
  it('linha duplicada (mesmo criativo e dia): só a primeira conta', () => {
    const r = build([ok, { ...ok, served: 999, visible: 999 }]);
    expect(r.totals!.served).toBe(10);
    expect(r.dataIssues[0]!.reason).toMatch(/duplicada/);
  });
  it('todas inválidas: sem totais (não mostra zero)', () => {
    expect(build([bad[0]![1]]).totals).toBeNull();
  });
});

describe('auditabilidade (perda de dedupe)', () => {
  it('sem lacuna: auditável, sem nota', () => {
    expect(build([row('c1', '2026-12-10', 1, 1, 0)]).auditability).toMatchObject({ auditable: true, lowerBound: false, gaps: [], note: null });
  });
  it('lacuna que toca a janela: não auditável, números são piso, com a nota', () => {
    const audit = new DeliveryAudit();
    audit.reportLoss({ detectedAtMs: Date.parse('2026-12-10T09:00:00-03:00'), reason: 'dedupe_perdido' });
    const r = build([row('c1', '2026-12-10', 1, 1, 0)], { audit });
    expect(r.auditability).toMatchObject({ auditable: false, lowerBound: true });
    expect(r.auditability.gaps).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/mínimos, não totais/);
  });
  it('lacuna fora da janela pedida não afeta', () => {
    const audit = new DeliveryAudit();
    audit.reportLoss({ detectedAtMs: Date.parse('2026-12-28T09:00:00-03:00'), reason: 'dedupe_perdido' });
    const r = build([row('c1', '2026-12-10', 1, 1, 0)], { audit, window: { from: '2026-12-01', to: '2026-12-15' } });
    expect(r.auditability.auditable).toBe(true);
  });
  it('o dia de hoje na janela avisa que ainda está em coleta', () => {
    expect(build([]).notes.join(' ')).toMatch(/hoje ainda está em coleta/);
    expect(build([], { now: '2027-03-01T12:00:00-03:00' }).notes.join(' ')).not.toMatch(/hoje ainda está em coleta/);
  });
});

describe('CSV', () => {
  const data = [row('c1', '2026-12-10', 100, 60, 3), row('c2', '2026-12-11', 0, 0, 0)];
  it('diário: BOM, CRLF, cabeçalho fixo, uma linha por criativo e dia COM registro', () => {
    const csv = reportDailyCsv(build(data));
    expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv.endsWith('\r\n')).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...DAILY_CSV_COLUMNS]);
    expect(rows).toHaveLength(3);
    const [, a, b] = rows;
    expect(a!.slice(0, 11)).toEqual(['cmp-1', 'Acme Rodapé', 'Acme Fidelidade', '2026-12-10', 'FOOTER', 'c1', '100', '60', '3', '0.6', '0.03']);
    expect(a![13]).toBe('sim');
    // servida 0: taxas vazias (não "0")
    expect(b!.slice(6, 11)).toEqual(['0', '0', '0', '', '']);
    for (const r of rows) expect(r).toHaveLength(DAILY_CSV_COLUMNS.length);
  });
  it('sem dado: só o cabeçalho (nenhuma linha de zero)', () => {
    expect(parseCsv(reportDailyCsv(build([])))).toEqual([[...DAILY_CSV_COLUMNS]]);
  });
  it('origem, data da coleta e auditabilidade vão em cada linha', () => {
    const audit = new DeliveryAudit(); audit.reportLoss({ detectedAtMs: Date.parse('2026-12-10T09:00:00-03:00'), reason: 'dedupe_perdido' });
    const [, a] = parseCsv(reportDailyCsv(build([row('c1', '2026-12-10', 1, 1, 0)], { audit })));
    expect(a![11]).toMatch(/^Servidor de anúncios/); expect(a![12]).toBe('2026-12-10T23:00:00-03:00'); expect(a![13]).toBe('nao');
  });
  it('célula: aspas duplicadas, vírgula, ponto e vírgula e quebra de linha; números e nulos sem aspas', () => {
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('diz "oi"')).toBe('"diz ""oi"""'); expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"'); expect(csvCell('simples')).toBe('simples');
    expect(csvCell(12)).toBe('12'); expect(csvCell(0.5)).toBe('0.5'); expect(csvCell(null)).toBe(''); expect(csvCell(undefined)).toBe('');
    expect(csvCell(NaN)).toBe(''); expect(csvCell(Infinity)).toBe(''); expect(csvCell(true)).toBe('sim'); expect(csvCell(false)).toBe('nao');
  });
  it('injeção de fórmula: nome de campanha/anunciante começando por = + - @ tab CR ganha apóstrofo', () => {
    for (const evil of ['=HYPERLINK("http://x","clique")', '+cmd|calc', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1']) {
      const csv = reportDailyCsv(build([row('c1', '2026-12-10', 1, 1, 0)], { campaign: camp({ name: evil }), advertiserName: evil }));
      const [, a] = parseCsv(csv);
      for (const cell of [a![1]!, a![2]!]) expect(cell.startsWith("'"), JSON.stringify(cell)).toBe(true);
      expect(a![1]!.slice(1)).toBe(evil);
    }
  });
  it('texto com fórmula no meio não é alterado; texto normal fica igual', () => {
    expect(csvCell('Acme = bom')).toBe('Acme = bom'); expect(csvCell('Acme')).toBe('Acme');
  });
  it('nome com vírgula e aspas atravessa o ciclo (gera e lê) sem perder nada', () => {
    const nome = 'Acme, "Fidelidade"\nLtda';
    const [, a] = parseCsv(reportDailyCsv(build([row('c1', '2026-12-10', 1, 1, 0)], { advertiserName: nome })));
    expect(a![2]).toBe(nome);
  });
  it('resumo: campo,valor com janela, origem, atualização, auditabilidade, estimado=nao e as definições', () => {
    const rows = parseCsv(reportSummaryCsv(build([row('c1', '2026-12-10', 100, 60, 3)])));
    expect(rows[0]).toEqual(['campo', 'valor']);
    const kv = new Map(rows.slice(1).filter((r) => r[0] !== 'definicao').map((r) => [r[0]!, r[1]!]));
    expect(kv.get('anunciante')).toBe('Acme Fidelidade'); expect(kv.get('janela_inicio')).toBe('2026-12-01'); expect(kv.get('janela_fim')).toBe('2027-01-31');
    expect(kv.get('janela_com_dado_inicio')).toBe('2026-12-10'); expect(kv.get('posicoes')).toBe('FOOTER | SIDEBAR_1');
    expect(kv.get('impressoes_servidas')).toBe('100'); expect(kv.get('impressoes_visiveis')).toBe('60'); expect(kv.get('cliques_validos')).toBe('3');
    expect(kv.get('estimado')).toBe('nao'); expect(kv.get('periodo_auditavel')).toBe('sim'); expect(kv.get('atualizado_em')).toBe('2026-12-10T23:00:00-03:00');
    expect(rows.filter((r) => r[0] === 'definicao')).toHaveLength(6);
    expect(kv.has('sem_dado')).toBe(true); expect(kv.get('sem_dado')).toBe('');
  });
  it('resumo sem dado: totais vazios (não 0) e o motivo preenchido', () => {
    const kv = new Map(parseCsv(reportSummaryCsv(build([]))).slice(1).map((r) => [r[0]!, r[1]!]));
    for (const k of ['impressoes_servidas', 'impressoes_visiveis', 'cliques_validos', 'taxa_visibilidade', 'ctr', 'atualizado_em']) expect(kv.get(k), k).toBe('');
    expect(kv.get('sem_dado')).toBe('Sem entrega registrada na janela.');
  });
  it('nome do arquivo: tipo, campanha e janela; caracteres perigosos saem', () => {
    const f = reportCsv(build([]), 'diario');
    expect(f).toMatchObject({ filename: 'relatorio-diario-cmp-1-2026-12-01-2027-01-31.csv', contentType: 'text/csv; charset=utf-8' });
    expect(reportCsv(build([], { campaign: camp({ id: '../../etc/passwd"x' }) }), 'resumo').filename).toMatch(/^relatorio-resumo-[a-z0-9-]+-2026-12-01-2027-01-31\.csv$/);
  });
});

describe('handlers (Studio)', () => {
  function setup(delivery?: DeliveryRow[]) {
    const state = createCommercialState();
    const acc = state.crm.createAccount('Acme Fidelidade', NOW);
    const c = state.campaigns.create({ name: 'Rodapé', accountId: acc.id, formatId: 'banners--banner-rodape', positionId: 'FOOTER', startDate: '2026-12-01', endDate: '2027-01-31' }, NOW);
    state.ads.addCreative(cr('cr-1', 'FOOTER', { campaignId: c.id }));
    state.inventory.reserve({ positionId: 'FOOTER', advertiserId: acc.id, campaignId: c.id, startDate: '2026-12-01', endDate: '2027-01-31', status: 'confirmed' });
    return { state, c, ctx: makeCtx(state, { now: NOW, today: '2026-12-20', flags: {}, actor: studio, delivery }) };
  }
  it('autenticação: 401 sem sessão e 403 sem permissão, nos dois', () => {
    const { state, c } = setup();
    const anon = makeCtx(state, { now: NOW });
    const leitor = makeCtx(state, { now: NOW, actor: { id: 'l', canManageCommercial: false } });
    for (const call of [h.getCampaignReport, h.exportCampaignReportCsv]) { expect(call(anon, { campaignId: c.id }).status).toBe(401); expect(call(leitor, { campaignId: c.id }).status).toBe(403); }
  });
  it('relatório pelo handler: usa ctx.delivery e o anunciante da conta', () => {
    const { ctx, c } = setup([row('cr-1', '2026-12-10', 10, 6, 1)]);
    const body = h.getCampaignReport(ctx, { campaignId: c.id }).body as CampaignReport;
    expect(body.advertiser.name).toBe('Acme Fidelidade'); expect(body.totals).toMatchObject({ served: 10, visible: 6, clicks: 1 });
    expect(body.positions.map((p) => p.positionId)).toEqual(['FOOTER']); expect(body.approvedCreatives.map((x) => x.id)).toEqual(['cr-1']);
  });
  it('sem ctx.delivery (Backend não hidratou): "sem entrega registrada", nunca número inventado', () => {
    const { ctx, c } = setup(undefined);
    const body = h.getCampaignReport(ctx, { campaignId: c.id }).body as CampaignReport;
    expect(body.totals).toBeNull(); expect(body.emptyState).toMatch(/não há entrega registrada/); // campanha em rascunho: ainda não ativada
  });
  it('janela pelo handler e erros: 404 campanha inexistente; 422 janela inválida; 400 parâmetro ruim', () => {
    const { ctx, c } = setup([row('cr-1', '2026-12-10', 10, 6, 1), row('cr-1', '2026-12-25', 20, 8, 2)]);
    expect((h.getCampaignReport(ctx, { campaignId: c.id, from: '2026-12-20', to: '2026-12-31' }).body as CampaignReport).totals!.served).toBe(20);
    expect(h.getCampaignReport(ctx, { campaignId: 'nope' }).status).toBe(404);
    const bad = h.getCampaignReport(ctx, { campaignId: c.id, from: '2026-12-20', to: '2026-12-10' });
    expect(bad.status).toBe(422); expect(JSON.stringify(bad.body)).toContain('INVALID_WINDOW');
    expect(h.getCampaignReport(ctx, { campaignId: c.id, from: 'ontem' }).status).toBe(400);
    expect(h.getCampaignReport(ctx, {}).status).toBe(400);
  });
  it('CSV pelo handler: diário e resumo, nome do arquivo e tipo; kind inválido => 400', () => {
    const { ctx, c } = setup([row('cr-1', '2026-12-10', 10, 6, 1)]);
    const d = h.exportCampaignReportCsv(ctx, { campaignId: c.id }).body as { filename: string; contentType: string; csv: string };
    expect(d.filename).toBe('relatorio-diario-cmp-1-2026-12-01-2027-01-31.csv'); expect(d.contentType).toBe('text/csv; charset=utf-8');
    expect(parseCsv(d.csv)).toHaveLength(2);
    const s = h.exportCampaignReportCsv(ctx, { campaignId: c.id, kind: 'resumo' }).body as { csv: string };
    expect(parseCsv(s.csv)[0]).toEqual(['campo', 'valor']);
    expect(h.exportCampaignReportCsv(ctx, { campaignId: c.id, kind: 'xlsx' }).status).toBe(400);
    expect(h.exportCampaignReportCsv(ctx, { campaignId: 'nope' }).status).toBe(404);
  });
  it('rotas na tabela: GET, só Studio', () => {
    for (const p of ['/api/commercial/studio/campaigns/report', '/api/commercial/studio/campaigns/report-csv']) expect(h.ROUTES.find((r) => r.path === p)).toMatchObject({ method: 'GET', auth: 'studio' });
  });
});

describe('datas de calendário reais', () => {
  it('2026-02-30 e semelhantes são recusadas na janela do relatório e no inventário (defesa em profundidade)', async () => {
    const { InventoryBook, InventoryError } = await import('./index');
    for (const bad of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-12-32']) {
      expect(() => build([], { window: { from: bad, to: '2027-01-31' } }), bad).toThrow(ReportError);
      expect(() => new InventoryBook().availability('TOP', bad, '2027-01-31'), bad).toThrow(InventoryError);
    }
    expect(() => build([], { window: { from: '2028-02-29', to: '2028-03-01' }, campaign: camp({ startDate: '2028-02-01', endDate: '2028-03-31' }) })).not.toThrow(); // ano bissexto é válido
    expect(() => build([], { window: { from: '2027-02-29', to: '2027-03-01' }, campaign: camp({ startDate: '2027-02-01', endDate: '2027-03-31' }) })).toThrow(ReportError); // 2027 não é bissexto
  });
});
