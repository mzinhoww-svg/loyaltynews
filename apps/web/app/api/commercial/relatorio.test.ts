/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { seedCommercial } from '../_lib/commercial/repo';
const SHA = 'a'.repeat(64);
const ARQUIVO_TOP = { arquivoRef: `anuncios/${SHA}.png`, arquivoMime: 'image/png', largura: 1280, altura: 150, tamanhoKb: 100, arquivoSha256: SHA, textoAlternativo: 'Oferta', destinoUrl: 'https://anunciante.example/x' };

// Relatório do anunciante: as linhas diárias de ad_delivery_daily entram no contexto SÓ nas rotas de relatório, filtradas pela campanha e pela janela.
let app: Awaited<ReturnType<typeof makeApp>>;
let comercial: Actor;
let leitor: Actor;
const rel = (q: Record<string, string>, as: Actor | null = comercial) => call(d, 'GET', { path: '/api/commercial/studio/campaigns/report', query: q, as });
const csv = (q: Record<string, string>) => call(d, 'GET', { path: '/api/commercial/studio/campaigns/report-csv', query: q, as: comercial });

beforeAll(async () => {
  app = await makeApp();
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Anunciante' });
  const camp = (id: string) => ({ id, nome: id, contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-11-01', fim: '2026-12-31', status: 'active' as const });
  await app.db.insert(schema.campaigns).values([camp('cmp-1'), camp('cmp-2')]);
  const cr = (id: string, campanhaId: string) => ({ id, campanhaId, slotId: 'TOP', peso: 1, inicio: '2026-11-01', fim: '2026-12-31', aprovado: true, ...ARQUIVO_TOP });
  await app.db.insert(schema.adCreatives).values([cr('cr-1', 'cmp-1'), cr('cr-2', 'cmp-2')]);
  const linha = (criativoId: string, dia: string, servidas: number, visiveis: number, cliques: number) =>
    ({ id: `${criativoId}@${dia}`, criativoId, dia, servidas, visiveis, cliques, ignoradasBotInterno: 2, refreshSuprimido: 1, atualizadoEm: new Date(`${dia}T20:00:00Z`) });
  await app.db.insert(schema.adDeliveryDaily).values([
    linha('cr-1', '2026-11-10', 100, 60, 3),
    linha('cr-1', '2026-11-11', 50, 30, 2),
    linha('cr-1', '2026-12-20', 999, 999, 99), // fora da janela pedida
    linha('cr-2', '2026-11-10', 700, 400, 40), // OUTRA campanha
  ]);
  [comercial, leitor] = [await app.actor('admin'), await app.actor('leitor')];
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('relatório do anunciante com a entrega do banco', () => {
  it('totais SÓ da campanha e da janela pedidas (a outra campanha e o dia fora da janela não entram)', async () => {
    const r = await rel({ campaignId: 'cmp-1', from: '2026-11-01', to: '2026-11-30' });
    expect(r.status).toBe(200);
    expect(r.body.emptyState).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain('cr-2');
    expect(r.body.totals).toMatchObject({ served: 150, visible: 90, clicks: 5 });
    expect(r.body.updatedAt).toBe('2026-11-11T20:00:00.000Z'); // a "data do dado": a linha mais recente contada
    expect(r.body.daily.map((x: any) => x.day)).toEqual(['2026-11-10', '2026-11-11']);
    expect(r.body.byCreative.map((x: any) => x.creativeId)).toEqual(['cr-1']);
  });

  it('janela maior inclui o dia de dezembro; sem janela traz todos os dias da campanha; sem linhas = "sem entrega" honesto (nunca inventa)', async () => {
    const todos = await rel({ campaignId: 'cmp-1' });
    expect(todos.body.totals).toMatchObject({ served: 1149, visible: 1089, clicks: 104 });
    expect(todos.body.daily.map((x: any) => x.day)).toContain('2026-12-20');
    const vazio = await rel({ campaignId: 'cmp-1', from: '2026-12-21', to: '2026-12-31' });
    expect(vazio.status).toBe(200);
    expect(vazio.body.totals).toBeNull(); // sem linha na janela: nada de zero inventado
    expect(vazio.body.emptyState).toBeTruthy();
    expect(vazio.body.daily).toEqual([]);
    expect((await rel({ campaignId: 'cmp-1', from: '2026-02-30' })).status).toBe(400); // data impossível é recusada
  });

  it('o CSV diário sai com as linhas e a data do dado (atualizado em); só quem gerencia o comercial lê; leitor 403', async () => {
    const r = await csv({ campaignId: 'cmp-1', kind: 'diario', from: '2026-11-01', to: '2026-11-30' });
    expect(r.status).toBe(200);
    expect(r.body.contentType).toMatch(/csv/);
    expect(r.body.csv).toContain('2026-11-10');
    expect(r.body.csv).not.toContain('2026-12-20');
    expect(r.body.csv).not.toContain('cr-2');
    expect((await rel({ campaignId: 'cmp-1' }, leitor)).status).toBe(403);
    expect((await rel({ campaignId: 'cmp-1' }, null)).status).toBe(401);
  });
});
