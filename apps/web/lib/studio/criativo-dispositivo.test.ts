import { describe, expect, it } from 'vitest';
import { conferirDimensao, dimensaoEsperada, varianteDoCriativo } from './criativo-dispositivo';

describe('criativo desktop × mobile no Studio', () => {
  it('dimensão esperada por posição e dispositivo', () => {
    expect(dimensaoEsperada('TOP', 'desktop')).toBe('1280x150');
    expect(dimensaoEsperada('TOP', 'mobile')).toBe('320x100');
    expect(dimensaoEsperada('FOOTER', 'mobile')).toBe('320x100');
    expect(dimensaoEsperada('SIDEBAR_2', 'mobile')).toBe('300x250');
    expect(dimensaoEsperada('ARTICLE_INLINE', 'mobile')).toBeNull();
  });
  it('recusa a dimensão errada para o dispositivo, inclusive a mobile da outra família', () => {
    expect(conferirDimensao('SIDEBAR_1', 'mobile', 300, 250)).toBeNull();
    expect(conferirDimensao('SIDEBAR_1', 'mobile', 320, 100)).toMatch(/esperado é 300x250/);
    expect(conferirDimensao('TOP', 'mobile', 300, 250)).toMatch(/esperado é 320x100/);
    expect(conferirDimensao('TOP', 'desktop', 320, 100)).toMatch(/esperado é 1280x150/);
    expect(conferirDimensao('AGENDA', 'mobile', 320, 100)).toMatch(/não tem criativo mobile/);
  });
  it('variante pela dimensão real do arquivo (regra do domínio)', () => {
    const asset = (width: number, height: number) => ({ width, height, mime: 'image/png', sizeKB: 10, sha256: 'a'.repeat(64), key: 'k' });
    expect(varianteDoCriativo({ positionId: 'TOP', asset: asset(1280, 150) })).toBe('desktop');
    expect(varianteDoCriativo({ positionId: 'TOP', asset: asset(320, 100) })).toBe('mobile');
    expect(varianteDoCriativo({ positionId: 'TOP' })).toBeNull();
  });
});
