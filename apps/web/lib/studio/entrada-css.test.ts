import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Pacote C, item 4: telas de entrada e Minha conta. Mesma regra do studio.css (F-26): só tokens do DS, nenhuma cor literal.
const css = readFileSync(join(__dirname, '../../app/studio/entrada.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const layout = readFileSync(join(__dirname, '../../app/studio/layout.tsx'), 'utf8');

describe('entrada.css', () => {
  it('não tem cor literal (hex, rgb, hsl, nome de cor): só tokens --ln-*', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/:\s*(white|black|red|green|blue|gray|grey)\b/);
    const vars = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!);
    expect(vars.length).toBeGreaterThan(10);
    expect(vars.filter((v) => !v.startsWith('--ln-'))).toEqual([]);
  });
  it('é carregado pelo layout raiz do Studio (entrada fica fora do layout protegido)', () => {
    expect(layout).toContain("import './entrada.css';");
  });
});
