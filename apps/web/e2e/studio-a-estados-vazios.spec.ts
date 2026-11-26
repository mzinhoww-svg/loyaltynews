import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// Estados vazios SEM PROVA no contrato das 20 telas (fast-track/qa/contrato-20-telas-62ffd2d3.md).
// Roda primeiro na ordem alfabética de propósito: o banco de e2e (PGlite em memória) sobe vazio, e é
// o único momento em que estes vazios acontecem sem semear nada. Se o estado voltar a ser silencioso
// (o seletor do contrato some e a tela fica sem mensagem), o teste falha.
test.describe('Estados vazios honestos (banco recém-criado)', () => {
  test.beforeEach(async ({ context }) => {
    await entrar(context, 'ana', 'admin');
  });

  test('correcoes-titular: fila vazia diz "Nenhum pedido", sem linha inventada', async ({ page }) => {
    await page.goto('/studio/correcoes-titular');
    await expect(page.getByRole('heading', { level: 1, name: 'Pedidos do titular' })).toBeVisible();
    const vazio = page.locator('section[aria-labelledby="vazio"]');
    await expect(vazio).toBeVisible();
    await expect(vazio.getByRole('heading', { level: 2, name: 'Nenhum pedido' })).toBeVisible();
    await expect(vazio).toContainText('Nenhum pedido do titular recebido até agora.');
    await expect(page.locator('table')).toHaveCount(0);
  });

  test('piloto/violacoes: sem violação tem estado próprio, não lista silenciosa', async ({ page }) => {
    await page.goto('/studio/piloto/violacoes');
    await expect(page.getByRole('heading', { level: 1, name: 'Violações do piloto' })).toBeVisible();
    const vazio = page.locator('[data-vazio="violacoes"]');
    await expect(vazio).toBeVisible();
    await expect(vazio.getByRole('heading', { level: 2, name: 'Nenhuma violação' })).toBeVisible();
  });

  test('seo: sem regra de link interno o vazio é declarado, não uma tabela vazia', async ({ page }) => {
    await page.goto('/studio/seo');
    await expect(page.getByRole('heading', { level: 1, name: 'SEO' })).toBeVisible();
    const vazio = page.locator('[data-vazio="links"]');
    await expect(vazio).toBeVisible();
    await expect(vazio).toContainText('Nenhuma regra de link interno.');
    await expect(page.locator('table[aria-label="Regras de links internos"]')).toHaveCount(0);
  });
});
