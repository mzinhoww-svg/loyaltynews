import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A tela de checagem foi sobrescrita uma vez por uma versão antiga (1ef379ae transplantado como a38f6e4e), que desfez o
// EmptyState do refino (0ba98373, travado em trava-estado-vazio.test.ts) e a seta em SVG (290e053c). Esta trava cobre a seta.
const src = readFileSync(join(__dirname, '../../app/studio/(protegido)/cms/checagem/page.tsx'), 'utf8');

describe('fila de checagem: a seta de voltar é o SVG, não o carácter', () => {
  it('usa <Seta> e não tem U+2190/U+2192 (fora do subset latin da Inter)', () => {
    expect(src).toContain('<Seta direcao="esquerda" />');
    expect(src).not.toMatch(/[←→]/);
  });
});
