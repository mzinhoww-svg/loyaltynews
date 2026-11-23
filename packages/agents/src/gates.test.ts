import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { BOUNDARY_TEST_COVERAGE, evaluateGatesOffline, GATES, P5_V2_SHA256 } from './gates';

describe('gates G1–G6', () => {
  it('têm critérios com dono, forma de medir e limiar; ids únicos e prefixados pelo gate', () => {
    expect(GATES.map((g) => g.id)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
    const ids = GATES.flatMap((g) => g.criteria.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GATES) {
      expect(g.criteria.length).toBeGreaterThan(0);
      for (const c of g.criteria) {
        expect(c.id.startsWith(`${g.id}.`)).toBe(true);
        expect(c.measure.length).toBeGreaterThan(5);
        expect(c.threshold.length).toBeGreaterThan(0);
        expect(c.owner.length).toBeGreaterThan(0);
      }
    }
  });

  it('o mapa de testes de fronteira cobre exatamente os 8 boundary_tests da P5 v2', () => {
    const { recoveryPolicy } = loadRegistries();
    expect(Object.keys(BOUNDARY_TEST_COVERAGE).sort()).toEqual([...recoveryPolicy.boundary_tests].sort());
    expect(recoveryPolicy.boundary_tests).toHaveLength(8);
  });

  it('a avaliação offline confere o repositório e cada critério tem avaliação', () => {
    const ev = evaluateGatesOffline();
    const byId = new Map(ev.map((e) => [e.criterion, e]));
    for (const c of GATES.flatMap((g) => g.criteria)) expect(byId.has(c.id), c.id).toBe(true);
    for (const id of ['G1.1', 'G1.2', 'G1.3', 'G2.6', 'G3.1', 'G3.2', 'G5.1', 'G6.1', 'G6.3']) expect(byId.get(id), id).toMatchObject({ status: 'met_offline' });
    expect(P5_V2_SHA256).toHaveLength(64);
  });

  it('o que depende de staging, ratificação, medição real ou terceiros NUNCA sai como atendido', () => {
    const ev = new Map(evaluateGatesOffline().map((e) => [e.criterion, e]));
    for (const id of ['G1.4', 'G2.1', 'G2.2', 'G2.3', 'G2.4', 'G2.5', 'G2.7', 'G3.3', 'G4.0', 'G4.1', 'G4.2', 'G4.3', 'G5.2', 'G5.3', 'G5.4', 'G5.5', 'G5.6', 'G6.2']) {
      expect(ev.get(id)!.status, id).toBe('external');
    }
    expect(ev.size).toBe(GATES.flatMap((g) => g.criteria).length);
  });
});
