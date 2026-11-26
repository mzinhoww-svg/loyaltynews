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
  it('tabelas (refino, pacote C item 2): cabeçalho fixo, sem overflow hidden na tabela, espaçamento e tons só com tokens', () => {
    expect(semComentarios).toMatch(/\.st-table thead th \{[^}]*position: sticky;[^}]*top: 0/);
    const regraTabela = /\.st-table \{[^}]*\}/.exec(semComentarios)?.[0] ?? '';
    expect(regraTabela).not.toMatch(/overflow: hidden/); // hidden cria quadro de rolagem e desliga o sticky
    expect(regraTabela).toMatch(/overflow: clip/);
    expect(/\.st-table th, \.st-table td \{[^}]*\}/.exec(semComentarios)?.[0]).toMatch(/padding: var\(--ln-space-2\) var\(--ln-space-3\)/);
    // todo tom de status (.st-badge.<estado>) usa o par -bg/-fg do mesmo tom, nunca uma cor solta
    for (const m of semComentarios.matchAll(/\.st-badge\.[a-z_]+ \{ background: var\(--ln-color-([a-z]+)-bg\); color: var\(--ln-color-([a-z]+)-fg\); \}/g)) expect(m[1]).toBe(m[2]);
  });
  it('tabela larga rola no próprio quadro no celular (F-27)', () => {
    expect(semComentarios).toMatch(/@media \(max-width: 860px\)[\s\S]*\.studio table \{[^}]*overflow-x: auto/);
  });
});
