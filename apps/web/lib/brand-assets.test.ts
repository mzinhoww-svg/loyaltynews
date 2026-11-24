import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITORIAS } from '../../../packages/contracts/src/editorias.data';

/** Assets de marca do lançamento (gerados por apps/web/scripts/brand/gerar-assets.mjs): existem, têm as dimensões e os pesos combinados. */
const web = resolve(__dirname, '..');
const pub = (p: string) => resolve(web, 'public', p);
const app = (p: string) => resolve(web, 'app', p);
const sharp = createRequire(resolve(web, '..', '..', 'package.json'))('sharp') as (b: Buffer) => { metadata(): Promise<{ width?: number; height?: number; format?: string }> };
const dim = async (f: string) => { const m = await sharp(readFileSync(f)).metadata(); return [m.width, m.height, m.format]; };
const KB = 1024;

describe('assets de marca do lançamento', () => {
  it('imagem de compartilhamento padrão 1200×630 e quadrada 1080×1080, até 60 KB', async () => {
    expect(await dim(pub('og/padrao.png'))).toEqual([1200, 630, 'png']);
    expect(await dim(pub('og/padrao-quadrada.png'))).toEqual([1080, 1080, 'png']);
    for (const f of ['og/padrao.png', 'og/padrao-quadrada.png']) expect(statSync(pub(f)).size).toBeLessThanOrEqual(60 * KB);
  });

  it('imagem social de cada uma das 10 editorias: 1200×630, até 60 KB', async () => {
    expect(EDITORIAS).toHaveLength(10);
    for (const e of EDITORIAS) {
      const f = pub(`og/editoria-${e.slug}.png`);
      expect(existsSync(f), e.slug).toBe(true);
      expect(await dim(f), e.slug).toEqual([1200, 630, 'png']);
      expect(statSync(f).size, e.slug).toBeLessThanOrEqual(60 * KB);
    }
  });

  it('ícone SVG de cada editoria: 24×24, currentColor, sem script nem imagem embutida', () => {
    for (const e of EDITORIAS) {
      const svg = readFileSync(pub(`icones/editorias/${e.slug}.svg`), 'utf8');
      expect(svg, e.slug).toMatch(/viewBox="0 0 24 24"/);
      expect(svg, e.slug).toMatch(/stroke="currentColor"/);
      expect(svg, e.slug).not.toMatch(/<script|<image|data:image|font-family/i);
      expect(svg.length, e.slug).toBeLessThan(1200);
    }
  });

  it('logo claro/escuro, monogramas e placeholders: SVG leves, sem script, com as cores do brandkit', () => {
    const arquivos = ['logo-sobre-claro', 'logo-sobre-escuro', 'logo-monocromatico', 'monograma-escuro', 'monograma-claro', 'placeholder-materia', 'placeholder-materia-escuro'];
    for (const n of arquivos) {
      const svg = readFileSync(pub(`brand/${n}.svg`), 'utf8');
      expect(svg, n).toMatch(/^<svg /);
      expect(svg, n).not.toMatch(/<script|<image|data:image|font-family/i);
      expect(statSync(pub(`brand/${n}.svg`)).size, n).toBeLessThanOrEqual(8 * KB);
    }
    expect(readFileSync(pub('brand/logo-sobre-claro.svg'), 'utf8')).toMatch(/#153C3C/);
    expect(readFileSync(pub('brand/logo-sobre-escuro.svg'), 'utf8')).toMatch(/#FFFFFF/);
    expect(readFileSync(pub('brand/placeholder-materia.svg'), 'utf8')).toMatch(/viewBox="0 0 1200 675"/);
  });

  it('favicon.ico com 16, 32 e 48 px; apple-icon 180; ícones de app 192 e 512 e maskable 512', async () => {
    const ico = readFileSync(app('favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1); // tipo ICO
    expect(ico.readUInt16LE(4)).toBe(3); // 3 imagens
    expect([0, 1, 2].map((i) => ico.readUInt8(6 + i * 16))).toEqual([16, 32, 48]);
    expect(ico.length).toBeLessThanOrEqual(8 * KB);
    expect(await dim(app('apple-icon.png'))).toEqual([180, 180, 'png']);
    expect(await dim(pub('brand/icon-192.png'))).toEqual([192, 192, 'png']);
    expect(await dim(pub('brand/icon-512.png'))).toEqual([512, 512, 'png']);
    expect(await dim(pub('brand/icon-maskable-512.png'))).toEqual([512, 512, 'png']);
  });

  it('manifesto do site aponta só para arquivos que existem', () => {
    const m = JSON.parse(readFileSync(pub('site.webmanifest'), 'utf8')) as { icons: { src: string }[]; theme_color: string; lang: string };
    expect(m.theme_color).toBe('#153C3C');
    expect(m.lang).toBe('pt-BR');
    for (const i of m.icons) expect(existsSync(pub(i.src.replace(/^\//, ''))), i.src).toBe(true);
  });
});
