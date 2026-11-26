import { describe, expect, it } from 'vitest';
import { INTELLIGENCE_ROUTES } from '../_lib/intelligence';

// Decisão de produto (26/11/2026): watchlist e alerta são do Studio (privados do dono). O portal público não os lê.
// Se uma rota pública de watchlist aparecer por acidente, este teste reprova.
describe('watchlists fora do portal público', () => {
  const publicas = INTELLIGENCE_ROUTES.filter((r) => r.path.startsWith('/api/intelligence/'));
  const deLista = INTELLIGENCE_ROUTES.filter((r) => /\/watchlists|\/alerts/.test(r.path));

  it('nenhuma rota pública lê watchlist ou alerta', () => {
    expect(publicas.filter((r) => /\/watchlists|\/alerts/.test(r.path)).map((r) => r.path)).toEqual([]);
  });

  it('toda rota de watchlist/alerta é do Studio e exige sessão', () => {
    expect(deLista.length).toBeGreaterThan(0);
    expect(deLista.filter((r) => !r.path.startsWith('/api/studio/intelligence/') || r.auth !== 'studio').map((r) => r.path)).toEqual([]);
  });
});
