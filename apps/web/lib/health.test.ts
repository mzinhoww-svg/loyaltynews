import { describe, expect, it } from 'vitest';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { healthPayload } from './health';

describe('health', () => {
  it('ok e nenhuma flag ligada por padrão', () => {
    expect(healthPayload(FLAG_DEFAULTS)).toEqual({ status: 'ok', service: 'loyaltynews-web', flagsLigadas: [] });
  });
});
