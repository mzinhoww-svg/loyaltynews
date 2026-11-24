import { expect, test } from '@playwright/test';

/**
 * Sem JavaScript, as listagens rápidas do portal mostram o CONTEÚDO, não o esqueleto de carregamento (decisão do PM sobre a recomendação
 * da UI/UX). Com `loading.tsx` o Next manda primeiro o esqueleto e depois o conteúdo num bloco escondido que só um script troca: quem não
 * roda JavaScript ficava só com o esqueleto. Mídia kit, Intelligence e a busca mantêm o próprio carregando (esperam a API).
 * Roda nos três modos (empty, mock, api), no build de produção.
 */
const ROTAS = ['/', '/noticias', '/flash', '/analises', '/entrevistas', '/opiniao', '/editoria/bancos', '/agenda'];

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const rota of ROTAS) {
    test(`${rota}: mostra o conteúdo, não o esqueleto`, async ({ page }) => {
      const r = await page.goto(rota);
      expect(r?.status(), rota).toBe(200);
      // Nenhum esqueleto visível…
      await expect(page.getByTestId('portal-loading'), rota).toBeHidden();
      // …e o conteúdo da página visível: o título (h1) e texto de verdade no <main>.
      await expect(page.locator('main h1').first(), rota).toBeAttached();
      const texto = (await page.locator('main').innerText()).trim();
      expect(texto.length, `${rota}: texto visível no main`).toBeGreaterThan(60);
      expect(texto, rota).not.toContain('Carregando…');
    });
  }
});
