import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Resolução de violação do piloto (Studio 2; PM-2026-11-23-D) sobre a rota do Backend 1 (ft/backend 0d886d9, migração 0028).
// Linhas MOCK com parada imediata vêm da seed ?seed=piloto-violacoes. A resolução é definitiva: o spec roda em série.
test.describe.configure({ mode: 'serial' });

const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const RESOLVE = (id: string) => `/api/studio/openbot/pilot/rows/${id}/1/resolve`;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  expect((await ctx.request.get('/api/e2e/login?seed=piloto-violacoes')).ok()).toBe(true);
  await ctx.close();
});

test('RBAC: só admin resolve; editor-chefe não entra na tela e a rota recusa', async ({ page, context }) => {
  await entrar(context, 'vio-chefe', 'editor_chefe');
  await page.goto('/studio/piloto/violacoes');
  await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  expect((await api(context, 'POST', RESOLVE('mock-viol-ferramenta'), { motivo: 'motivo suficiente aqui', acaoTomada: 'agente_corrigido' })).status).toBe(403);
});

test('admin vê as linhas com violação pendentes; segredo em log exige rotação (tela e rota); axe', async ({ page, context }) => {
  await entrar(context, 'vio-adm', 'admin');
  await page.goto('/studio/piloto/violacoes');
  await expect(page.getByRole('heading', { level: 1, name: 'Violações do piloto' })).toBeVisible();
  await expect(page.locator('[data-linha="mock-viol-segredo-1"]')).toHaveAttribute('data-estado', 'pendente');
  await expect(page.locator('[data-linha="mock-viol-ferramenta-1"]')).toContainText('Ferramenta fora do contrato');
  await expect(page.locator('#acao-mock-viol-segredo-1')).toHaveValue('segredo_rotacionado');
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  // a rota também exige: segredo em log com outra ação = 409 ACTION_REQUIRED
  expect((await api(context, 'POST', RESOLVE('mock-viol-segredo'), { motivo: 'motivo suficiente aqui', acaoTomada: 'agente_corrigido' })).status).toBe(409);

  const form = page.getByRole('form', { name: 'Resolver mock-viol-segredo-1' });
  await form.locator('#acao-mock-viol-segredo-1').selectOption('agente_corrigido');
  await form.getByLabel('Motivo (10 a 500 caracteres)').fill('Agente reconfigurado sem acesso ao log.');
  await form.getByRole('checkbox').check();
  await enviar(page, form.getByRole('button', { name: 'Resolver violação' }));
  await erro(page, 'segredo rotacionado');
});

test('resolver: pede confirmação; registra autor, data, ação e motivo; a linha continua na planilha; repetir não muda nada', async ({ page, context }) => {
  await entrar(context, 'vio-adm', 'admin');
  await page.goto('/studio/piloto/violacoes');
  let form = page.getByRole('form', { name: 'Resolver mock-viol-ferramenta-1' });
  await form.locator('#acao-mock-viol-ferramenta-1').selectOption('agente_corrigido');
  await form.getByLabel('Motivo (10 a 500 caracteres)').fill('Contrato do agente atualizado; ferramenta removida.');
  await enviar(page, form.getByRole('button', { name: 'Resolver violação' }));
  await erro(page, 'Marque a confirmação');

  form = page.getByRole('form', { name: 'Resolver mock-viol-ferramenta-1' });
  await form.locator('#acao-mock-viol-ferramenta-1').selectOption('agente_corrigido');
  await form.getByLabel('Motivo (10 a 500 caracteres)').fill('Contrato do agente atualizado; ferramenta removida.');
  await form.getByRole('checkbox').check();
  await enviar(page, form.getByRole('button', { name: 'Resolver violação' }));
  await sucesso(page, 'resolvida e auditada');
  const linha = page.locator('[data-linha="mock-viol-ferramenta-1"]');
  await expect(linha).toHaveAttribute('data-estado', 'resolvida');
  await expect(linha.locator('[data-tratada]')).toContainText('ação: agente_corrigido');
  await expect(linha.locator('[data-tratada]')).toContainText('Contrato do agente atualizado');
  await expect(page.locator('[data-linha="mock-viol-segredo-1"]')).toHaveAttribute('data-estado', 'pendente');

  // nada é apagado: a linha continua na trilha, com a violação marcada e o tratamento
  const l = await api(context, 'GET', '/api/studio/openbot/piloto/linhas');
  const item = (l.body.items as { task_id: string; tool_outside_contract: boolean; tratada?: { acao: string } }[]).find((x) => x.task_id === 'mock-viol-ferramenta');
  expect(item).toMatchObject({ tool_outside_contract: true, tratada: { acao: 'agente_corrigido' } });
  // idempotente: repetir devolve a resolução original (200), sem trocar a ação
  const again = await api(context, 'POST', RESOLVE('mock-viol-ferramenta'), { motivo: 'outro motivo qualquer', acaoTomada: 'despacho_bloqueado' });
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ jaResolvida: true, tratada: { acao: 'agente_corrigido' } });
});
