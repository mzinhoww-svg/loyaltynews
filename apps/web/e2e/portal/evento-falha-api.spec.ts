import { expect, test } from '@playwright/test';

/**
 * N7 (auditoria de estado honesto, 26/11): erro na leitura de um evento fora da lista de próximos não é "não encontrado".
 * No servidor MOCK, `ev-falha` responde 500 na rota por id e não está na lista; `ev-nao-existe` responde 404 (controle negativo).
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const outroCenario = Boolean(process.env.PORTAL_API_DOWN || process.env.PORTAL_API_SITE || process.env.PORTAL_API_ADS || process.env.PORTAL_API_INTEL || process.env.PORTAL_API_FALHA);

test.describe('evento: erro de leitura x inexistente', () => {
  test.skip(mode !== 'api' || outroCenario, 'modo api completo');

  test('rota por id com 500: página de erro com noindex e calendário 503', async ({ page, request }) => {
    const res = await page.goto('/agenda/ev-falha');
    expect(res?.status()).toBe(200);
    await expect(page.getByText('Não conseguimos carregar este evento agora')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
    const ics = await request.get('/agenda/ev-falha/ics');
    expect(ics.status()).toBe(503);
    expect(ics.headers()['retry-after']).toBe('60');
  });

  test('controle negativo: 404 continua "não encontrado" e evento existente abre', async ({ page, request }) => {
    const res = await page.goto('/agenda/ev-nao-existe');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    await expect(page.getByText('Não conseguimos carregar este evento agora')).toHaveCount(0);
    expect((await request.get('/agenda/ev-nao-existe/ics')).status()).toBe(404);
    await page.goto('/agenda/ev-passado');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK] Evento encerrado');
  });
});
