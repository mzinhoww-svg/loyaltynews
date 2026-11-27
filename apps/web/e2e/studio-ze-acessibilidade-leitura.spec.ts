import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// ACESSIBILIDADE E TECLADO NAS 20 TELAS DE LEITURA (fast-track, item D).
// - axe (wcag2a/aa + 21a/aa): zero violacao serious/critical;
// - foco visivel: o elemento focado pelo teclado tem contorno (outline ou box-shadow), nunca `outline: none` puro;
// - ordem de tabulacao: o foco anda para frente, a partir do topo, sem pular para tras nem parar em elemento escondido;
// - erro anunciado: as recusas aparecem com role=alert/status e nao so por cor.

const TELAS = [
  '/studio/agenda',
  '/studio/auditoria',
  '/studio/campanhas',
  '/studio/cms/checagem',
  '/studio/cms/correcoes',
  '/studio/cms',
  '/studio/cms/pautas',
  '/studio/correcoes-titular',
  '/studio/creative',
  '/studio/crm',
  '/studio/decisoes',
  '/studio/entidades',
  '/studio/fontes',
  '/studio/midia',
  '/studio/organogramas',
  '/studio/piloto',
  '/studio/piloto/violacoes',
  '/studio/seo',
  '/studio/social',
  '/studio/watchlists',
] as const;

test('axe: zero violacao serious/critical nas 20 telas de leitura', async ({ page, context }) => {
  await entrar(context, 'a11y-leitura', 'admin');
  const graves: string[] = [];
  for (const rota of TELAS) {
    await page.goto(rota);
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of ax.violations) {
      if (v.impact === 'serious' || v.impact === 'critical') graves.push(`${rota}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 1).map((n) => n.target.join(' ')).join('')}`);
    }
  }
  expect(graves, graves.join('\n')).toEqual([]);
});

test('teclado: foco visivel e ordem de tabulacao para frente nas 20 telas', async ({ page, context }) => {
  await entrar(context, 'a11y-leitura', 'admin');
  const problemas: string[] = [];

  for (const rota of TELAS) {
    await page.goto(rota);
    await page.keyboard.press('Tab'); // sai do documento/barra do navegador
    let anterior = -1;
    for (let i = 0; i < 6; i++) {
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const visivel = el.offsetWidth > 0 || el.offsetHeight > 0;
        const contorno = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth || '0') > 0;
        const sombra = s.boxShadow !== 'none';
        const focaveis = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'));
        return { tag: el.tagName, texto: (el.textContent ?? '').trim().slice(0, 40), visivel, foco: contorno || sombra, indice: focaveis.indexOf(el) };
      });
      if (!info) continue;
      if (!info.visivel) problemas.push(`${rota}: foco em elemento escondido (${info.tag} "${info.texto}")`);
      if (!info.foco) problemas.push(`${rota}: foco sem contorno visivel (${info.tag} "${info.texto}")`);
      if (info.indice <= anterior) problemas.push(`${rota}: tabulacao nao avancou (${info.tag} "${info.texto}" indice ${info.indice} <= ${anterior})`);
      anterior = info.indice;
      await page.keyboard.press('Tab');
    }
  }

  expect(problemas, problemas.join('\n')).toEqual([]);
});

test('erro e anunciado por leitor de tela (role=alert/status), nao so por cor', async ({ page, context }) => {
  // entrada: motivo chega como alerta
  await page.goto('/studio/entrar?motivo=NO_MFA');
  await expect(page.getByRole('alert').first()).toBeVisible();

  // leitura com filtro invalido: o Backend recusa e a tela anuncia a recusa
  await entrar(context, 'a11y-leitura', 'admin');
  await page.goto('/studio/cms?status=estado-que-nao-existe');
  const alerta = page.locator('main [role="alert"], main [role="status"]').first();
  await expect(alerta).toBeVisible();
});
