import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// F-26 (auditoria): o Studio usa os tokens do Brandkit; nenhuma cor literal no CSS do painel.
const css = readFileSync(join(__dirname, '../../app/studio/studio.css'), 'utf8');
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('studio.css', () => {
  it('não tem cor literal (hex, rgb, hsl): só tokens --ln-*', () => {
    expect(semComentarios).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(semComentarios).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });
  it('usa a fonte de UI do Brandkit, não a do sistema', () => {
    expect(semComentarios).toContain('var(--ln-font-ui)');
    expect(semComentarios).not.toMatch(/system-ui/);
  });
  it('tabela larga rola no próprio quadro no celular (F-27)', () => {
    expect(semComentarios).toMatch(/@media \(max-width: 860px\)[\s\S]*\.studio table \{[^}]*overflow-x: auto/);
  });
});
