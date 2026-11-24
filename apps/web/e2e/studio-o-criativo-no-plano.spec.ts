import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { definirFlag, entrar, enviar } from './helpers';
import { png } from './png-teste';

// Criativo aprovado chegando ao plano público (/api/commercial/ads/plan) — fecha a pendência do 15e42eb depois da DP-43 (capacidade liberada
// para Topo, Laterais e Rodapé SÓ no staging, CAPACITY_RELEASES). Só roda com APP_ENV=staging (no build e no servidor de e2e); em produção a
// capacidade não é liberada e o studio-n-criativo-real prova a recusa. Blob em memória (MOCK) e adServerVendas ligados só no backend de e2e.
const STAGING = process.env.APP_ENV === 'staging';
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somarDias = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const blob = async (context: BrowserContext, ligado: boolean) => expect((await context.request.get(`/api/e2e/login?blob=memoria&on=${ligado ? 1 : 0}`)).ok()).toBe(true);
type Slot = { positionId: string; available: boolean; width: number | null; height: number | null; mobile: { width: number; height: number }[] };
const plano = async (page: Page) => ((await (await page.request.get('/api/commercial/ads/plan?positions=SIDEBAR_1')).json()) as { slots: Slot[] }).slots[0]!;

test.describe('Criativo aprovado no plano (staging, DP-43)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!STAGING, 'só com APP_ENV=staging: a capacidade da DP-43 não vale em produção');
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.request.get('/api/e2e/login?blob=memoria&on=0');
    await ctx.request.get('/api/e2e/login?flag=adServerVendas&on=0');
    await ctx.close();
  });

  test('formato liberado, campanha ativa com desktop e mobile aprovados: o plano mostra a posição e a variante mobile', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await blob(context, true);
    await definirFlag(context, 'adServerVendas', false);
    const inicio = hojeSp();
    const fim = somarDias(inicio, 40);

    await page.goto('/studio/crm');
    await page.getByLabel('Nome do anunciante').fill('Plano Staging SA');
    await enviar(page, page.getByRole('button', { name: 'Criar anunciante' }));
    await sucesso(page, 'Anunciante criado.');
    await page.goto('/studio/campanhas');
    // o formato das laterais está "disponivel" (DP-43) no catálogo do staging
    await expect(page.getByLabel('Formato').locator('option[value="banners--retangulo-sidebar"]')).toContainText('disponivel');
    await page.getByLabel('Nome', { exact: true }).fill('Lateral no Ar');
    await page.getByLabel('Anunciante (conta)').selectOption({ label: 'Plano Staging SA' });
    await page.getByLabel('Formato').selectOption('banners--retangulo-sidebar');
    await page.getByLabel('Início (obrigatório)').fill(inicio);
    await page.getByLabel('Fim (obrigatório)').fill(fim);
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await sucesso(page, 'Campanha criada em rascunho.');
    const url = page.url().split('?')[0]!;
    await page.getByTestId('posicoes-campanha').getByLabel('SIDEBAR_1').check();
    await enviar(page, page.getByRole('button', { name: 'Salvar posições' }));
    await sucesso(page, 'Posições da campanha atualizadas.');

    // dois criativos com arquivo real: desktop 336x280 e mobile 300x250
    const novo = async (alt: string) => {
      await page.getByLabel('Texto alternativo').fill(alt);
      await page.getByLabel('Destino (https').fill('https://planostaging.example/oferta');
      await enviar(page, page.getByRole('button', { name: 'Adicionar criativo' }));
      await sucesso(page, 'Criativo adicionado');
      await page.waitForLoadState('networkidle');
      return (await page.locator('li[data-criativo]').last().getAttribute('data-criativo'))!;
    };
    const enviarArquivo = async (id: string, dispositivo: 'desktop' | 'mobile', w: number, h: number) => {
      await page.getByLabel(`Dispositivo de ${id}`).selectOption(dispositivo);
      await page.getByLabel(`Arquivo de ${id}`).setInputFiles({ name: `${id}.png`, mimeType: 'image/png', buffer: png(w, h) });
      await enviar(page, page.getByRole('button', { name: `Enviar arquivo de ${id}` }));
      await sucesso(page, 'Arquivo do criativo enviado');
      await page.waitForLoadState('networkidle');
    };
    const d = await novo('Lateral no ar, desktop');
    const m = await novo('Lateral no ar, celular');
    await enviarArquivo(d, 'desktop', 336, 280);
    await enviarArquivo(m, 'mobile', 300, 250);

    // reserva pelo comercial; aprovações (imagens e campanha) pelo proprietário (DP-43)
    await enviar(page, page.getByRole('button', { name: 'Reservar posição' }));
    await sucesso(page, 'Posição reservada.');
    await enviar(page, page.getByRole('button', { name: 'Mover para reserved' }));
    await sucesso(page, 'Estado da campanha atualizado.');
    await entrar(context, 'dono', 'admin');
    await page.goto(url);
    for (const id of [d, m]) {
      await enviar(page, page.getByRole('button', { name: `Aprovar ${id}` }));
      await sucesso(page, 'Criativo aprovado.');
    }
    await enviar(page, page.getByRole('button', { name: 'Mover para approved' }));
    await sucesso(page, 'Estado da campanha atualizado.');

    // com a venda desligada, aprovado ainda não é "no ar": plano vazio
    expect(await plano(page)).toMatchObject({ positionId: 'SIDEBAR_1', available: false, mobile: [] });

    // venda ligada (só no backend de e2e): ativar passa e o plano mostra a posição (desktop 336x280) e a variante mobile 300x250
    await definirFlag(context, 'adServerVendas', true);
    await page.goto(url);
    // a pré-reserva (held) não basta para ativar, mesmo com a venda ligada: o domínio recusa e o plano segue vazio (ressalva do QA 7, 4458710)
    await enviar(page, page.getByRole('button', { name: 'Mover para active' }));
    await expect(page.locator('main .st-alert.err').filter({ hasText: /sem reserva confirmada/ }).first()).toBeVisible();
    await expect(page.locator('main .st-badge').first()).toHaveText('approved');
    expect(await plano(page)).toMatchObject({ positionId: 'SIDEBAR_1', available: false, mobile: [] });
    // com a venda ligada, a reserva é confirmada (venda) e aí a ativação passa
    await page.goto(url);
    await page.getByLabel('Confirmar venda').check();
    await enviar(page, page.getByRole('button', { name: 'Reservar posição' }));
    await sucesso(page, 'Posição reservada.');
    await expect(page.locator('tr[data-reserva][data-status="confirmed"]')).toHaveCount(1);
    await enviar(page, page.getByRole('button', { name: 'Mover para active' }));
    await sucesso(page, 'Estado da campanha atualizado.');
    await expect(page.locator('main .st-badge').first()).toHaveText('active');
    expect(await plano(page)).toEqual({ positionId: 'SIDEBAR_1', available: true, width: 336, height: 280, mobile: [{ width: 300, height: 250 }] });

    // a imagem pública do criativo no ar sai do armazenamento, com os bytes enviados
    const img = await page.request.get(`/api/commercial/ads/creative-image?id=${encodeURIComponent(d)}`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toBe('image/png');
    expect([...(await img.body()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ax.violations.map((v) => v.id)).toEqual([]);

    // venda desligada de novo: o plano volta a vazio (nada fica no ar sem a flag)
    await definirFlag(context, 'adServerVendas', false);
    expect(await plano(page)).toMatchObject({ positionId: 'SIDEBAR_1', available: false, mobile: [] });
    await blob(context, false);
  });
});
