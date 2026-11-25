import { describe, expect, it } from 'vitest';
import { catalogFor } from './catalog';
import { generateMediaKit } from './mediakit';
import { MetricStore } from './metrics';

const NOW = '2026-11-25T12:00:00.000Z';
const kit = (env: 'production' | 'staging') => generateMediaKit({ store: new MetricStore(), now: NOW, catalog: catalogFor(env) });

describe('ressalva pública do mídia kit (DP-54)', () => {
  it('produção: os 47 ficam disponíveis para proposta e os 14 de canal desligado saem COM ressalva', () => {
    const formats = kit('production').blocks.catalogo.formats;
    expect(formats).toHaveLength(47);
    expect(formats.every((f) => f.status === 'disponivel')).toBe(true);

    const comRessalva = formats.filter((f) => f.ressalva);
    expect(comRessalva).toHaveLength(14);
    for (const f of comRessalva) {
      expect(f.ressalva).toMatch(/^Ressalva: a entrega só começa com o canal ativo/);
      // A ressalva não repete jargão interno (id de decisão, flags).
      expect(f.ressalva).not.toMatch(/DP-\d/);
    }
    // Fora dos 14, nenhum ganha ressalva por engano.
    expect(formats.filter((f) => !f.ressalva)).toHaveLength(33);
  });

  it('o campo é público: o motivo interno (statusReason) continua só na visão do Studio', () => {
    const publico = generateMediaKit({ store: new MetricStore(), now: NOW, catalog: catalogFor('production') });
    expect(publico.blocks.catalogo.formats.some((f) => 'statusReason' in f)).toBe(false);
    const interno = generateMediaKit({ store: new MetricStore(), now: NOW, catalog: catalogFor('production'), internal: true });
    expect(interno.blocks.catalogo.formats.some((f) => 'statusReason' in f)).toBe(true);
  });

  it('staging (DP-43): 3 disponíveis sem ressalva, 30 sob consulta, 14 indisponíveis — nada é promovido', () => {
    const formats = kit('staging').blocks.catalogo.formats;
    expect(formats.filter((f) => f.status === 'disponivel')).toHaveLength(3);
    expect(formats.filter((f) => f.status === 'sob_consulta')).toHaveLength(30);
    expect(formats.filter((f) => f.status === 'indisponivel')).toHaveLength(14);
    expect(formats.some((f) => f.ressalva)).toBe(false);
  });
});
