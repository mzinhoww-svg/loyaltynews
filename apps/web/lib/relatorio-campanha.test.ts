import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeliveryAudit, buildCampaignReport, type Campaign, type Creative, type DeliveryRow } from '@ln/commercial';
import { Relatorio, csvHref } from '../app/studio/(protegido)/campanhas/[id]/_components/Relatorio';

const NOW = '2026-12-20T12:00:00-03:00';
const camp: Campaign = {
  id: 'cmp-1', name: 'Acme Rodapé', accountId: 'acc-1', opportunityId: null, formatId: 'banners--banner-rodape', positionIds: ['FOOTER'], positionId: 'FOOTER',
  startDate: '2026-12-01', endDate: '2027-01-31', status: 'active', reservationIds: [], sponsoredLabel: true, history: [],
};
const creative = (id: string, positionId: string, over: Partial<Creative> = {}): Creative => ({
  id, campaignId: 'cmp-1', positionId, weight: 1, startDate: '2026-12-01', endDate: '2027-01-31', approved: true, campaignActive: true,
  asset: { key: 'k', mime: 'image/png', width: positionId === 'FOOTER' ? 1280 : 336, height: positionId === 'FOOTER' ? 200 : 280, sizeKB: 50, sha256: 'ab'.repeat(32) },
  altText: 'x', advertiserName: 'Acme', destinationUrl: 'https://a.example', ...over,
});
const row = (creativeId: string, day: string, served: number, visible: number, clicks: number, over: Partial<DeliveryRow> = {}): DeliveryRow =>
  ({ creativeId, day, served, visible, clicks, ignoredBotInternal: 0, refreshSuppressed: 0, updatedAt: `${day}T22:15:00-03:00`, ...over });

const report = (delivery: DeliveryRow[], over: Partial<Parameters<typeof buildCampaignReport>[0]> = {}) =>
  buildCampaignReport({ campaign: camp, advertiserName: 'Acme Fidelidade', creatives: [creative('c1', 'FOOTER'), creative('c2', 'SIDEBAR_1'), creative('c3', 'FOOTER', { approved: false })], reservations: [], delivery, audit: new DeliveryAudit(), now: NOW, ...over });
const html = (r: ReturnType<typeof report>) => renderToStaticMarkup(createElement(Relatorio, { r }));
/** Texto da célula com o data-testid dado. */
const cell = (markup: string, id: string): string => new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(markup)?.[1] ?? '__ausente__';

describe('Relatório do anunciante (Studio)', () => {
  const data = [row('c1', '2026-12-10', 1200, 700, 30, { ignoredBotInternal: 90, refreshSuppressed: 12 }), row('c2', '2026-12-11', 34, 10, 1)];

  it('cabeçalho: anunciante, posições com dimensão, criativos aprovados e pendentes', () => {
    const m = html(report(data));
    expect(cell(m, 'rel-anunciante')).toBe('Acme Fidelidade');
    expect(m).toContain('Banner rodapé (1280×200)'); expect(m).toContain('Sidebar 1 (336×280)');
    expect(cell(m, 'rel-criativos')).toContain('c1, c2'); expect(m).toContain('1 aguardando aprovação');
    expect(m).toContain('01/12/2026 a 31/01/2027');
  });
  it('números CONTADOS com formato pt-BR, origem e data da coleta; nunca estimado', () => {
    const m = html(report(data));
    expect(cell(m, 'rel-servidas')).toBe('1.234'); expect(cell(m, 'rel-visiveis')).toBe('710'); expect(cell(m, 'rel-cliques')).toBe('31');
    expect(cell(m, 'rel-taxa-vis')).toBe('57,5%'); expect(cell(m, 'rel-ctr')).toBe('2,5%');
    expect(cell(m, 'rel-origem')).toMatch(/^Servidor de anúncios do Loyalty News/);
    expect(cell(m, 'rel-atualizado')).toBe('11/12/2026 22:15');
    expect(cell(m, 'rel-estimado')).toBe('não: só o que foi contado');
    expect(cell(m, 'rel-janela')).toContain('01/12/2026 a 31/01/2027');
    expect(m).toContain('com dado de 10/12/2026 a 11/12/2026');
    expect(m).toContain('90 de bots ou tráfego interno'); expect(m).toContain('12 de auto-refresh');
  });
  it('tabelas por dia, por posição e por criativo com os mesmos totais', () => {
    const m = html(report(data));
    expect(m).toContain('data-testid="rel-por-dia"'); expect(m).toContain('data-testid="rel-por-posicao"'); expect(m).toContain('data-testid="rel-por-criativo"');
    expect(m).toContain('<th scope="row">10/12/2026</th><td>1.200</td><td>700</td><td>30</td>');
    expect(m).toContain('<th scope="row">FOOTER</th><td>1.200</td><td>700</td><td>30</td>');
    expect(m).toContain('<th scope="row">c2</th><td>SIDEBAR_1</td><td>34</td><td>10</td><td>1</td>');
  });
  it('SEM dado: "—" em todos os números (nunca 0), sem tabelas e com o motivo', () => {
    const m = html(report([]));
    for (const id of ['rel-servidas', 'rel-visiveis', 'rel-cliques', 'rel-taxa-vis', 'rel-ctr', 'rel-atualizado']) expect(cell(m, id), id).toBe('—');
    expect(m).not.toContain('rel-por-dia'); expect(m).not.toContain('rel-excluidos');
    expect(cell(m, 'rel-vazio')).toBe('Sem entrega registrada na janela.');
    expect(m).not.toContain('com dado de');
  });
  it('servida 0 com registro: servidas "0" (é dado real) e as taxas "—" (não inventa 0%)', () => {
    const m = html(report([row('c1', '2026-12-10', 0, 0, 0)]));
    expect(cell(m, 'rel-servidas')).toBe('0'); expect(cell(m, 'rel-taxa-vis')).toBe('—'); expect(cell(m, 'rel-ctr')).toBe('—');
  });
  it('perda de dedupe: o aviso de "mínimos, não totais" aparece', () => {
    const audit = new DeliveryAudit(); audit.reportLoss({ detectedAtMs: Date.parse('2026-12-10T09:00:00-03:00'), reason: 'dedupe_perdido' });
    expect(cell(html(report(data, { audit })), 'rel-avisos')).not.toBe('__ausente__');
    expect(html(report(data, { audit }))).toMatch(/mínimos, não totais/);
    expect(html(report(data))).not.toMatch(/mínimos, não totais/);
  });
  it('linhas inconsistentes são avisadas e ficam fora dos números', () => {
    const m = html(report([row('c1', '2026-12-10', 10, 20, 0), row('c1', '2026-12-11', 10, 5, 1)]));
    expect(cell(m, 'rel-servidas')).toBe('10'); expect(m).toMatch(/1 linha\(s\) de entrega com inconsistência/);
  });
  it('exportação: dois links de CSV com a janela, e o atributo download', () => {
    const m = html(report(data));
    expect(m).toContain('href="/studio/campanhas/cmp-1/relatorio?tipo=diario&amp;de=2026-12-01&amp;ate=2027-01-31"');
    expect(m).toContain('href="/studio/campanhas/cmp-1/relatorio?tipo=resumo&amp;de=2026-12-01&amp;ate=2027-01-31"');
    expect((m.match(/ download/g) ?? []).length).toBe(2);
    expect(csvHref('a/b c', 'diario', '2026-12-01', '2026-12-31')).toBe('/studio/campanhas/a%2Fb%20c/relatorio?tipo=diario&de=2026-12-01&ate=2026-12-31');
  });
  it('sem cobrança nem faturamento: nenhuma menção a preço, valor, fatura, R$ ou cobrança', () => {
    for (const m of [html(report(data)), html(report([]))]) expect(m).not.toMatch(/R\$|fatur|cobran|pre[cç]o|valor a pagar|invoice/i);
  });
  it('texto vindo do cadastro é escapado (nome de anunciante com HTML não vira marcação)', () => {
    const m = html(report(data, { advertiserName: '<script>alert(1)</script>' }));
    expect(m).not.toContain('<script>alert(1)</script>'); expect(m).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('anunciante desconhecido mostra "—" (não inventa nome)', () => {
    expect(cell(html(report(data, { advertiserName: null })), 'rel-anunciante')).toBe('—');
  });
  it('as definições (como os números são contados) acompanham o relatório', () => {
    const m = html(report(data));
    expect(m).toContain('Como os números são contados'); expect(m).toMatch(/50% da área/); expect(m).toMatch(/Nenhum número é estimado/);
  });
});
