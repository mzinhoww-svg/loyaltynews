import { describe, expect, it } from 'vitest';
import { emDemonstracao, type AmbienteDemo } from '../app/(portal)/_lib/demo';

const base: AmbienteDemo = { appEnv: 'production', nodeEnv: 'production', portalDemo: '0', mock: false };

describe('faixa de demonstração por ambiente', () => {
  it('staging com fonte api + seed mostra a faixa (o defeito do G1)', () => {
    expect(emDemonstracao({ ...base, appEnv: 'staging', mock: false })).toBe(true);
  });

  it('staging com fonte mock também mostra', () => {
    expect(emDemonstracao({ ...base, appEnv: 'staging', mock: true })).toBe(true);
  });

  it('produção não mostra, nem com fonte mock', () => {
    expect(emDemonstracao({ ...base, appEnv: 'production', mock: false })).toBe(false);
    expect(emDemonstracao({ ...base, appEnv: 'production', mock: true })).toBe(false);
  });

  it('vitrine de staging (constante de build) mostra; dev com mock mostra; dev com api não', () => {
    expect(emDemonstracao({ ...base, nodeEnv: 'production', portalDemo: '1', mock: true })).toBe(true);
    expect(emDemonstracao({ ...base, nodeEnv: 'development', mock: true })).toBe(true);
    expect(emDemonstracao({ ...base, nodeEnv: 'development', mock: false })).toBe(false);
  });

  it('controle negativo: a regra antiga (só mock) não veria o staging com api', () => {
    const antiga = (a: typeof base) => (a.nodeEnv !== 'production' || a.portalDemo === '1') && a.mock;
    expect(antiga({ ...base, appEnv: 'staging', mock: false })).toBe(false);
    expect(emDemonstracao({ ...base, appEnv: 'staging', mock: false })).toBe(true);
  });
});
