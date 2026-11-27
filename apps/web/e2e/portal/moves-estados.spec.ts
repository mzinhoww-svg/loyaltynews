import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Os TRÊS estados vazios de /moves, cada um no seu cenário de dado (QA 8, parecer 822bcc7):
 *  (a) sem nenhuma publicação — modo FAKE_API_INTEL=vazio;
 *  (b) existem Moves na base, mas não publicados nesta versão — modo retido;
 *  (c) recurso COM Moves e filtro que não casa nada — modo full, ?q= sem casamento.
 * Cada estado tem texto próprio, nenhum "vazio genérico", e o axe tem de ficar sem serious/critical.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const intel = process.env.PORTAL_API_INTEL ?? '';

const semGraves = async (page: import('@playwright/test').Page, rotulo: string) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`axe moves ${rotulo}: ${graves.length} serious/critical de ${r.violations.length} violação(ões)`);
  expect(graves.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}`), rotulo).toEqual([]);
};

test.describe('Moves: os três estados vazios', () => {
  test('(a) sem publicações: "Ainda não há Moves publicados"', async ({ page }) => {
    test.skip(mode !== 'api' || intel !== 'vazio', 'somente com FAKE_API_INTEL=vazio');
    const res = await page.goto('/moves');
    expect(res?.status()).toBe(200);
    await expect(page.getByText('Ainda não há Moves publicados')).toBeVisible();
    await expect(page.getByTestId('moves-empty-honest')).toBeVisible();
    await expect(page.getByTestId('moves-empty-withheld')).toHaveCount(0);
    await expect(page.getByTestId('moves-filter-empty')).toHaveCount(0);
    await expect(page.getByTestId('moves-list')).toHaveCount(0);
    // P1 do Auditor: com o banco vazio, o estado "sem publicações" vence o filtro; ?q= não escondeu nada.
    await page.goto('/moves?q=foo');
    await expect(page.getByText('Ainda não há Moves publicados')).toBeVisible();
    await expect(page.getByTestId('moves-filter-empty')).toHaveCount(0);
    await expect(page.getByText(/escondido/i)).toHaveCount(0);
    await semGraves(page, 'sem-publicacoes');
  });

  test('(b) dado retido nesta versão: "Existem movimentações, ainda não publicadas nesta versão"', async ({ page }) => {
    test.skip(mode !== 'api' || intel !== 'retido', 'somente com FAKE_API_INTEL=retido');
    const res = await page.goto('/moves');
    expect(res?.status()).toBe(200);
    // P1 do Auditor: o estado retido só existe COM CONTAGEM; sem número, a frase não pode aparecer.
    await expect(page.getByText(/Existe? \d+ movimentaç/)).toBeVisible();
    await expect(page.getByText('Existem movimentações, ainda não publicadas nesta versão', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('moves-empty-withheld')).toContainText(/\d+ movimentaç/);
    await expect(page.getByText('Ainda não há Moves publicados')).toHaveCount(0);
    await expect(page.getByTestId('moves-filter-empty')).toHaveCount(0);
    await semGraves(page, 'retido');
  });

  test('(c) filtro sem resultado: cita o filtro e oferece limpar', async ({ page }) => {
    test.skip(mode !== 'api' || intel !== '', 'somente no modo api completo');
    const res = await page.goto('/moves?q=ninguem-com-esse-nome');
    expect(res?.status()).toBe(200);
    await expect(page.getByText('Nenhum Move para “ninguem-com-esse-nome”')).toBeVisible();
    await expect(page.getByTestId('moves-filter-empty')).toBeVisible();
    await expect(page.getByTestId('moves-filter-empty-clear')).toHaveAttribute('href', '/moves');
    await expect(page.getByTestId('moves-filter-clear')).toHaveAttribute('href', '/moves');
    await expect(page.getByText('Ainda não há Moves publicados')).toHaveCount(0);
    await expect(page.getByText(/Existe? \d+ movimentaç/)).toHaveCount(0);

    // Alvos de toque medidos a 390 e 768 (tablet): "limpar" e "Ver todos os Moves" com pelo menos 44x44.
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/moves?q=ninguem-com-esse-nome');
      for (const id of ['moves-filter-clear', 'moves-filter-empty-clear']) {
        // boundingBox não espera a visibilidade: espera o conteúdo aparecer antes de medir.
        await expect(page.getByTestId(id), `${width}px ${id}`).toBeVisible();
        const box = await page.getByTestId(id).boundingBox();
        expect(box, `${width}px ${id} visível`).not.toBeNull();
        expect(box!.width, `${width}px ${id} largura`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `${width}px ${id} altura`).toBeGreaterThanOrEqual(44);
      }
    }

    // O filtro que casa mostra a lista; limpar volta ao feed completo.
    await page.goto('/moves?q=Alfa');
    await expect(page.getByTestId('moves-list').getByRole('listitem')).toHaveCount(1);
    await semGraves(page, 'filtro-sem-resultado');
  });
});
