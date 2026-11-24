import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// F-27 (auditoria): nenhuma tela do Studio pode ter rolagem horizontal da PÁGINA a 390 px (tabelas largas rolam dentro do próprio quadro).
const MODULOS = [
  'cms', 'fontes', 'agenda', 'home-menus', 'seo', 'midia', 'social', 'creative', 'entidades', 'organogramas', 'watchlists', 'crm', 'inventario',
  'campanhas', 'analytics', 'organizacao', 'reunioes', 'decisoes', 'modelops', 'finops', 'auditoria', 'configuracoes', 'permissoes',
];

test.describe('Studio no celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  // P2-10: botões, campos e seletores com pelo menos 44 px de altura
  for (const slug of ['', 'cms', 'cms/nova', 'cms/checagem', 'cms/correcoes', 'home-menus', 'agenda', 'seo', 'midia', 'fontes', 'entidades', 'cms/pautas', 'fontes/fabrica', 'crm', 'campanhas', 'inventario', 'creative']) {
    test(`/studio/${slug || '(início)'}: alvos de toque de 44 px`, async ({ page, context }) => {
      await entrar(context, 'ana', 'admin');
      await page.goto(`/studio/${slug}`);
      const pequenos = await page.evaluate(() =>
        [...document.querySelectorAll('main .st-btn, main button, main select, main textarea, main input:not([type="hidden"]):not([type="file"]), main a:only-child, main summary')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.closest('details:not([open])') === null && r.height < 43.5; })
          .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}:${Math.round(el.getBoundingClientRect().height)}`),
      );
      expect(pequenos, `menores que 44 px: ${pequenos.slice(0, 6).join(', ')}`).toEqual([]);
    });
  }

  // revisão visual P2-3: título e subtítulo têm espaço abaixo (não encostam nos botões ou campos seguintes)
  test('títulos h1 e h2 têm margem inferior da escala do DS', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/cms/nova');
    const m = await page.evaluate(() => ({
      h1: parseFloat(getComputedStyle(document.querySelector('main h1')!).marginBottom),
      h2: parseFloat(getComputedStyle(document.querySelector('main h2')!).marginBottom),
    }));
    expect(m.h1).toBeGreaterThanOrEqual(12);
    expect(m.h2).toBeGreaterThanOrEqual(8);
  });

  // revisão visual P2-6: títulos do Studio em Inter (fonte de interface), não em serifa
  test('títulos h1, h2 e h3 usam a fonte de interface (Inter)', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/cms/nova');
    const f = await page.evaluate(() => ['h1', 'h2', 'h3'].map((t) => { const el = document.querySelector('main ' + t); return el ? t + ':' + getComputedStyle(el).fontFamily : null; }).filter(Boolean));
    expect(f.length).toBeGreaterThanOrEqual(2);
    for (const x of f) expect(x, x).toMatch(/Inter/i);
    for (const x of f) expect(x, x).not.toMatch(/Georgia/i);
  });

  for (const slug of MODULOS) {
    test(`/studio/${slug} não rola na horizontal`, async ({ page, context }) => {
      await entrar(context, 'ana', 'admin');
      await page.goto(`/studio/${slug}`);
      await expect(page.locator('main h1').first()).toBeVisible();
      const r = await page.evaluate(() => {
        const janela = window.innerWidth;
        const quem = [...document.querySelectorAll('main *')]
          .filter((el) => {
            if (el.getBoundingClientRect().right <= janela + 1) return false;
            // dentro de um quadro que rola por conta própria (ex.: tabela larga) o conteúdo pode passar da janela
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const ox = getComputedStyle(p).overflowX;
              if ((ox === 'auto' || ox === 'scroll') && p.getBoundingClientRect().right <= janela + 1) return false;
            }
            return true;
          })
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}${el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : ''}:${Math.round(el.getBoundingClientRect().right)}`);
        return { doc: document.documentElement.scrollWidth, janela, quem };
      });
      expect(r.doc, `scrollWidth ${r.doc} > ${r.janela}; largos: ${r.quem.join(', ')}`).toBeLessThanOrEqual(r.janela);
    });
  }
});
