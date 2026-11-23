import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// F-27 (auditoria): nenhuma tela do Studio pode ter rolagem horizontal da PÁGINA a 390 px (tabelas largas rolam dentro do próprio quadro).
const MODULOS = [
  'cms', 'fontes', 'agenda', 'home-menus', 'seo', 'midia', 'social', 'creative', 'entidades', 'organogramas', 'watchlists', 'crm', 'inventario',
  'campanhas', 'analytics', 'organizacao', 'reunioes', 'decisoes', 'modelops', 'finops', 'auditoria', 'configuracoes', 'permissoes',
];

test.describe('Studio no celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 800 } });

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
