/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { seedCommercial } from '../_lib/commercial/repo';

// Relatório do ANUNCIANTE (todas as campanhas da conta), com as linhas reais de ad_delivery_daily: soma só o que foi contado, nunca estima.
const SHA = 'a'.repeat(64);
const ARQ = { arquivoRef: `anuncios/${SHA}.png`, arquivoMime: 'image/png', largura: 1280, altura: 150, tamanhoKb: 100, arquivoSha256: SHA, textoAlternativo: 'Oferta', destinoUrl: 'https://anunciante.example/x' };
let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let editor: Actor;
const rel = (q: Record<string, string>, as: Actor | null = admin) => call(d, 'GET', { path: '/api/commercial/studio/accounts/report', query: q, as });
const csv = (q: Record<string, string>) => call(d, 'GET', { path: '/api/commercial/studio/accounts/report-csv', query: q, as: admin });

beforeAll(async () => {
  app = await makeApp();
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values([{ id: 'acc-a', nome: 'Anunciante A' }, { id: 'acc-b', nome: 'Anunciante B' }, { id: 'acc-vazia', nome: 'Sem campanha' }]);
  const camp = (id: string, contaId: string, inicio: string, fim: string) => ({ id, nome: `Campanha ${id}`, contaId, formatoId: 'banners--banner-topo', slotId: 'TOP', inicio, fim, status: 'active' as const });
  await app.db.insert(schema.campaigns).values([camp('cmp-1', 'acc-a', '2026-11-01', '2026-11-30'), camp('cmp-2', 'acc-a', '2026-11-15', '2026-12-31'), camp('cmp-b', 'acc-b', '2026-11-01', '2026-12-31')]);
  const cr = (id: string, campanhaId: string) => ({ id, campanhaId, slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: true, ...ARQ });
  await app.db.insert(schema.adCreatives).values([cr('cr-1', 'cmp-1'), cr('cr-2', 'cmp-2'), cr('cr-b', 'cmp-b')]);
  const linha = (criativoId: string, dia: string, servidas: number, visiveis: number, cliques: number, hora = '20:00:00') =>
    ({ id: `${criativoId}@${dia}`, criativoId, dia, servidas, visiveis, cliques, ignoradasBotInterno: 2, refreshSuprimido: 1, atualizadoEm: new Date(`${dia}T${hora}Z`) });
  await app.db.insert(schema.adDeliveryDaily).values([
    linha('cr-1', '2026-11-10', 100, 60, 3),
    linha('cr-1', '2026-11-20', 50, 30, 2),
    linha('cr-2', '2026-11-20', 200, 100, 10, '21:30:00'),
    linha('cr-2', '2026-12-20', 400, 200, 20),
    linha('cr-b', '2026-11-20', 9999, 9999, 999), // OUTRO anunciante: nunca entra
  ]);
  [admin, editor] = [await app.actor('admin'), await app.actor('editor')];
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('GET /api/commercial/studio/accounts/report', () => {
  it('sem janela: do menor início ao maior fim; soma SÓ as campanhas da conta; série diária soma o mesmo dia de campanhas diferentes', async () => {
    const r = await rel({ accountId: 'acc-a' });
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.advertiser).toEqual({ id: 'acc-a', name: 'Anunciante A' });
    expect(b.window).toEqual({ from: '2026-11-01', to: '2026-12-31', effective: { from: '2026-11-10', to: '2026-12-20' } });
    expect(b.totals).toEqual({ served: 750, visible: 390, clicks: 35, visibleRate: 0.52, ctr: 0.046667 });
    expect(b.excluded).toEqual({ botOrInternal: 8, refreshSuppressed: 4 });
    expect(b.daily.find((x: any) => x.day === '2026-11-20')).toMatchObject({ served: 250, visible: 130, clicks: 12 });
    expect(b.campaigns.map((c: any) => [c.id, c.totals?.served, c.positions])).toEqual([['cmp-1', 150, ['TOP']], ['cmp-2', 600, ['TOP']]]);
    expect(b.updatedAt).toBe('2026-12-20T20:00:00.000Z');
    expect(b.source.table).toBe('ad_delivery_daily');
    expect([b.estimated, b.emptyState]).toEqual([false, null]);
    expect(JSON.stringify(b)).not.toMatch(/preco|valor|price|amount/i); // sem cobrança
  });

  it('janela recorta: só novembro tira o dia de dezembro; campanha fora da janela não entra e vira nota', async () => {
    const nov = await rel({ accountId: 'acc-a', from: '2026-11-01', to: '2026-11-30' });
    expect(nov.body.totals).toMatchObject({ served: 350, visible: 190, clicks: 15 });
    const dez = await rel({ accountId: 'acc-a', from: '2026-12-01', to: '2026-12-31' });
    expect(dez.body.campaigns.map((c: any) => c.id)).toEqual(['cmp-2']);
    expect(dez.body.notes.join(' ')).toMatch(/1 campanha\(s\) do anunciante fora da janela/);
    const nada = await rel({ accountId: 'acc-a', from: '2026-11-01', to: '2026-11-05' });
    expect([nada.body.totals, nada.body.emptyState]).toEqual([null, 'Sem entrega registrada na janela.']); // sem linha = null, nunca zero
  });

  it('estados vazios honestos: conta sem campanha; janela sem campanha', async () => {
    const v = await rel({ accountId: 'acc-vazia' });
    expect([v.status, v.body.window, v.body.totals, v.body.emptyState]).toEqual([200, null, null, 'O anunciante ainda não tem campanha.']);
    const fora = await rel({ accountId: 'acc-a', from: '2027-06-01', to: '2027-06-30' });
    expect([fora.body.campaigns, fora.body.totals, fora.body.emptyState]).toEqual([[], null, 'Nenhuma campanha do anunciante toca a janela.']);
  });

  it('erros: 404 conta; 422 INVALID_WINDOW (invertida ou > 366 dias); 400 data inexistente ou sem accountId; 401 sem sessão; 403 editor', async () => {
    expect((await rel({ accountId: 'acc-x' })).status).toBe(404);
    expect((await rel({ accountId: 'acc-a', from: '2026-12-01', to: '2026-11-01' })).body.error.code).toBe('INVALID_WINDOW');
    expect((await rel({ accountId: 'acc-a', from: '2026-01-01', to: '2027-01-02' })).body.error.code).toBe('INVALID_WINDOW');
    expect((await rel({ accountId: 'acc-a', from: '2026-02-30' })).status).toBe(400);
    expect((await rel({})).status).toBe(400);
    expect((await rel({ accountId: 'acc-a' }, null)).status).toBe(401);
    expect((await rel({ accountId: 'acc-a' }, editor)).status).toBe(403);
  });
});

describe('GET /api/commercial/studio/accounts/report-csv', () => {
  it('diário: uma linha por campanha, criativo e dia COM registro (4), com origem e data; nada do outro anunciante', async () => {
    const r = await csv({ accountId: 'acc-a', kind: 'diario' });
    expect(r.status).toBe(200);
    expect(r.body.contentType).toBe('text/csv; charset=utf-8');
    expect(r.body.csv.charCodeAt(0)).toBe(0xfeff); // BOM: o Excel lê os acentos
    expect(r.body.filename).toBe('relatorio-anunciante-diario-acc-a-2026-11-01-2026-12-31.csv');
    const linhas = r.body.csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(linhas[0]).toMatch(/^campanha_id,campanha,anunciante,data,/);
    expect(linhas).toHaveLength(5);
    expect(linhas.some((l: string) => l.includes('cmp-b') || l.includes('9999'))).toBe(false);
    expect(linhas[1]).toContain('2026-11-10T20:00:00.000Z');
  });

  it('resumo: campo,valor com janela, origem e totais + uma linha por campanha; sem dado fica vazio, nunca 0', async () => {
    const r = await csv({ accountId: 'acc-a', kind: 'resumo' });
    const t = r.body.csv.replace(/^\uFEFF/, '');
    expect(t).toContain('impressoes_servidas,750');
    expect(t).toContain('estimado,nao');
    expect(t).toMatch(/\r\ncmp-1,Campanha cmp-1,active,2026-11-01,2026-11-30,TOP,150,90,5,/);
    const vazio = (await csv({ accountId: 'acc-a', kind: 'resumo', from: '2026-11-01', to: '2026-11-05' })).body.csv;
    expect(vazio).toContain('impressoes_servidas,\r\n');
  });
});
