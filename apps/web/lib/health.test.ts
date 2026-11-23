import { describe, expect, it } from 'vitest';
import { healthPayload } from './health';

describe('health', () => {
  it('devolve version e env, sem flags', () => {
    const p = healthPayload({ APP_COMMIT: 'abc1234', APP_ENV: 'homologacao' });
    expect(p).toEqual({ status: 'ok', service: 'loyaltynews-web', version: 'abc1234', env: 'homologacao' });
    expect(Object.keys(p)).not.toContain('flagsLigadas');
  });
  it('sem variáveis, valores neutros', () => {
    expect(healthPayload({})).toMatchObject({ version: 'unknown', env: 'local' });
  });
});
