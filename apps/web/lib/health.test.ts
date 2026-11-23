import { describe, expect, it } from 'vitest';
import { healthPayload } from './health';

describe('health', () => {
  it('devolve version e env; flags só como lista de nomes', () => {
    const p = healthPayload({ APP_COMMIT: 'abc1234', APP_ENV: 'homologacao' });
    expect(p).toEqual({ status: 'ok', service: 'loyaltynews-web', version: 'abc1234', env: 'homologacao', flags: [] });
    expect(Object.keys(p)).not.toContain('flagsLigadas');
  });
  it('flags ligadas aparecem só pelo nome', () => {
    expect(healthPayload({ APP_ENV: 'staging' }, ['intelligencePessoas']).flags).toEqual(['intelligencePessoas']);
  });
  it('sem variáveis, valores neutros', () => {
    expect(healthPayload({})).toMatchObject({ version: 'unknown', env: 'local' });
  });
});
