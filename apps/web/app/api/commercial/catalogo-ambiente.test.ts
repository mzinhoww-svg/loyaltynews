import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { makeApp } from '../_lib/testkit';
import { hydrate, seedCommercial } from '../_lib/commercial/repo';

// DP-43: a disponibilidade dos formatos vem do código (CAPACITY_RELEASES, por ambiente) + estado do banco, falhando fechado.
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
  it('produção, local e ambiente ausente: nenhum formato disponível', async () => {
    for (const env of ['production', null] as const) expect(disponiveis(await status(env)), String(env)).toEqual([]);
    // sem o 3º argumento, o ambiente vem de APP_ENV (ausente nos testes): nada liberado
    expect(disponiveis(Object.fromEntries((await hydrate(app.db, NOW)).state.catalog.map((f) => [f.id, f.status])))).toEqual([]);
  });
  it('o banco nunca promove: disponivel gravado num formato não liberado vale sob_consulta; o motivo do banco não vaza para o público', async () => {
    await grava('banners--banner-dentro-do-artigo', 'disponivel');
    await grava('redes-e-canais--envio-whatsapp', 'disponivel');
    for (const env of ['staging', 'production'] as const) {
      const s = await status(env);
      expect(s['banners--banner-dentro-do-artigo'], env).toBe('sob_consulta');
      expect(s['redes-e-canais--envio-whatsapp'], env).toBe('indisponivel'); // o código manda: continua indisponível
    }
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
  it('o motivo mostrado cita a DP-43 nos liberados', async () => {
    const f = (await hydrate(app.db, NOW, 'staging')).state.catalog.find((x) => x.id === 'banners--banner-topo')!;
    expect(f.statusReason).toContain('DP-43');
  });
});
