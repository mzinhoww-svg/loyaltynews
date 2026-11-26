import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG } from '@ln/commercial';
import { schema } from '@ln/db';
import { makeApp } from '../_lib/testkit';
import { hydrate, seedCommercial } from '../_lib/commercial/repo';

// DP-43 (staging) e DP-54 (produção): a disponibilidade dos formatos vem do código (CAPACITY_RELEASES, por ambiente) + estado do banco, falhando fechado.
// Staging: só os 3 formatos da DP-43. Produção: os 47, para proposta (DP-54, 24/11/2026). Local, CI e ambiente ausente: nenhum.
let app: Awaited<ReturnType<typeof makeApp>>;
const LIBERADOS = ['banners--banner-topo', 'banners--retangulo-sidebar', 'banners--banner-rodape'];
const NOW = new Date('2026-12-05T15:00:00Z');
const status = async (env: 'staging' | 'production' | null) => Object.fromEntries((await hydrate(app.db, NOW, env)).state.catalog.map((f) => [f.id, f.status]));
const disponiveis = (s: Record<string, string>) => Object.entries(s).filter(([, v]) => v === 'disponivel').map(([k]) => k).sort();
const grava = (id: string, disponibilidade: 'disponivel' | 'sob_consulta' | 'indisponivel') => app.db.update(schema.adFormats).set({ disponibilidade, motivoDisponibilidade: `banco:${disponibilidade}` }).where(eq(schema.adFormats.id, id));

beforeAll(async () => {
  app = await makeApp();
  await seedCommercial(app.db);
}, 120_000);
afterAll(async () => { await app.close(); });

describe('catálogo por ambiente sobre o banco (seed com tudo sob consulta)', () => {
  it('staging: os 3 formatos liberados ficam disponíveis mesmo com o sob_consulta gravado pelo seed; os outros 44 não mudam', async () => {
    const s = await status('staging');
    expect(disponiveis(s)).toEqual([...LIBERADOS].sort());
    expect(Object.values(s).filter((v) => v === 'sob_consulta')).toHaveLength(30);
    expect(Object.values(s).filter((v) => v === 'indisponivel')).toHaveLength(14);
  });
  it('produção (DP-54): os 47 formatos ficam disponíveis para proposta, inclusive os 14 de canal desligado, que levam a ressalva no motivo', async () => {
    const s = await status('production');
    expect(Object.keys(s)).toHaveLength(47);
    expect(disponiveis(s)).toHaveLength(47);
    const catalogo = (await hydrate(app.db, NOW, 'production')).state.catalog;
    for (const f of catalogo) expect(f.statusReason, f.id).toContain('DP-54');
    const desligados = ['redes-e-canais--carrossel-instagram', 'redes-e-canais--envio-whatsapp', 'redes-e-canais--nota-na-newsletter', 'impulsionamento--instagram'];
    for (const id of desligados) expect(catalogo.find((f) => f.id === id)!.statusReason, id).toContain('Ressalva');
    expect(catalogo.filter((f) => f.statusReason.includes('Ressalva'))).toHaveLength(14);
    expect(catalogo.find((f) => f.id === 'banners--banner-topo')!.statusReason).not.toContain('Ressalva');
  });
  it('local, CI e ambiente ausente: nenhum formato disponível', async () => {
    for (const env of [null] as const) expect(disponiveis(await status(env)), String(env)).toEqual([]);
    // sem o 3º argumento, o ambiente vem de APP_ENV (ausente nos testes): nada liberado
    expect(disponiveis(Object.fromEntries((await hydrate(app.db, NOW)).state.catalog.map((f) => [f.id, f.status])))).toEqual([]);
  });
  it('o banco nunca promove: disponivel gravado num formato não liberado vale sob_consulta; o motivo do banco não vaza para o público', async () => {
    await grava('banners--banner-dentro-do-artigo', 'disponivel');
    await grava('redes-e-canais--envio-whatsapp', 'disponivel');
    // staging não libera esses dois e o banco não os promove; ambiente ausente também não (o código manda)
    for (const env of ['staging', null] as const) {
      const s = await status(env);
      expect(s['banners--banner-dentro-do-artigo'], String(env)).toBe('sob_consulta');
      expect(s['redes-e-canais--envio-whatsapp'], String(env)).toBe('indisponivel');
    }
    // em produção eles estão disponíveis porque o CÓDIGO os liberou (DP-54), não porque o banco disse disponivel
    await grava('banners--banner-dentro-do-artigo', 'sob_consulta');
    await grava('redes-e-canais--envio-whatsapp', 'sob_consulta');
    const p = await status('production');
    expect(p['banners--banner-dentro-do-artigo']).toBe('disponivel');
    expect(p['redes-e-canais--envio-whatsapp']).toBe('disponivel');
    await grava('banners--banner-dentro-do-artigo', 'sob_consulta');
    await grava('redes-e-canais--envio-whatsapp', 'sob_consulta');
  });
  it("'indisponivel' no banco rebaixa um formato liberado, sem deploy; voltar a 'sob_consulta' o libera de novo", async () => {
    await grava('banners--banner-topo', 'indisponivel');
    const s = await status('staging');
    expect(s['banners--banner-topo']).toBe('indisponivel');
    expect(disponiveis(s)).toEqual(['banners--banner-rodape', 'banners--retangulo-sidebar']);
    await grava('banners--banner-topo', 'sob_consulta');
    expect(disponiveis(await status('staging'))).toEqual([...LIBERADOS].sort());
  });
  it("'indisponivel' no banco rebaixa também em produção, sem deploy (a chave de retirada continua valendo para os 47)", async () => {
    await grava('banners--banner-dentro-do-artigo', 'indisponivel');
    const s = await status('production');
    expect(s['banners--banner-dentro-do-artigo']).toBe('indisponivel');
    expect(disponiveis(s)).toHaveLength(46);
    await grava('banners--banner-dentro-do-artigo', 'sob_consulta');
    expect(disponiveis(await status('production'))).toHaveLength(47);
  });
  it("o 'indisponivel' que o seed gravou (cópia do código) não vale como retirada; uma retirada com motivo próprio vale, nos 14 formatos de canal desligado", async () => {
    const id = 'redes-e-canais--envio-whatsapp';
    const padrao = CATALOG.find((f) => f.id === id)!;
    // volta a linha ao que o seed gravou (os testes anteriores mexem nela)
    await app.db.update(schema.adFormats).set({ disponibilidade: 'indisponivel', motivoDisponibilidade: padrao.statusReason }).where(eq(schema.adFormats.id, id));
    const [linha] = await app.db.select().from(schema.adFormats).where(eq(schema.adFormats.id, id));
    expect(linha!.disponibilidade).toBe('indisponivel'); // o seed gravou o que o código dizia
    expect((await status('production'))[id]).toBe('disponivel'); // e a liberação da DP-54 prevalece
    expect((await status('staging'))[id]).toBe('indisponivel'); // o staging não libera: o código manda
    await app.db.update(schema.adFormats).set({ motivoDisponibilidade: 'retirado pela operação: sem número oficial' }).where(eq(schema.adFormats.id, id));
    expect((await status('production'))[id]).toBe('indisponivel'); // retirada deliberada rebaixa
    expect(disponiveis(await status('production'))).toHaveLength(46);
    await app.db.update(schema.adFormats).set({ disponibilidade: 'indisponivel', motivoDisponibilidade: padrao.statusReason }).where(eq(schema.adFormats.id, id));
  });
  it('o motivo mostrado cita a DP-43 nos liberados', async () => {
    const f = (await hydrate(app.db, NOW, 'staging')).state.catalog.find((x) => x.id === 'banners--banner-topo')!;
    expect(f.statusReason).toContain('DP-43');
  });
});
