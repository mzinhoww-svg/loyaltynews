import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// Telas honestas (25/11): a lista nunca apresenta falha de leitura como "nenhum registro", e o vazio diz o que falta,
// por que falta e como popular. O design system é o EmptyState: role=status no vazio, role=alert no erro.
// Os casos usam filtro inválido/vazio para não depender de o banco do e2e estar limpo (os specs dividem o mesmo banco).

test('campanhas: filtro sem resultado vira vazio honesto e filtro inválido vira erro, não zero', async ({ page, context }) => {
  await entrar(context, 'honesto-camp', 'comercial');

  // filtro que não acha nada: diz o que falta e como voltar a ver a lista
  await page.goto('/studio/campanhas?q=zzz-nao-existe-campanha');
  const vazio = page.locator('main .ln-empty').first();
  await expect(vazio).toBeVisible();
  await expect(vazio).toHaveAttribute('role', 'status');
  await expect(vazio.getByRole('heading', { name: 'Nenhuma campanha com esses filtros' })).toBeVisible();
  await expect(vazio).toContainText('nome contém "zzz-nao-existe-campanha"');
  await expect(vazio).toContainText('Limpe os filtros');
  await expect(page.locator('main .st-empty'), 'caixa improvisada antiga').toHaveCount(0);

  // leitura recusada pelo Backend: erro explícito, nunca a lista apresentada como vazia
  await page.goto('/studio/campanhas?status=xyz');
  const erro = page.locator('main .ln-empty.ln-empty--error').first();
  await expect(erro).toBeVisible();
  await expect(erro).toHaveAttribute('role', 'alert');
  await expect(erro.getByRole('heading', { name: 'Não foi possível carregar a lista' })).toBeVisible();
  await expect(erro).toContainText('Nada foi contado nem zerado');
  await expect(erro.getByRole('link', { name: 'Tentar de novo' })).toBeVisible();
});

test('CRM: leitura recusada não vira "Nenhum lead" — aparece como erro com o motivo', async ({ page, context }) => {
  await entrar(context, 'honesto-crm', 'comercial');
  await page.goto('/studio/crm?status=xyz');
  const erro = page.locator('main .ln-empty.ln-empty--error').first();
  await expect(erro).toBeVisible();
  await expect(erro).toHaveAttribute('role', 'alert');
  await expect(erro).toContainText('Nada foi contado nem zerado');
  await expect(page.getByRole('heading', { name: 'Nenhum lead' }), 'zero apresentado como dado').toHaveCount(0);
});

test('fila de checagem: vazio honesto da Fábrica explica o comando e o caminho pelo CMS', async ({ page, context }) => {
  await entrar(context, 'honesto-check', 'admin');
  await page.goto('/studio/cms/checagem');
  const vazio = page.locator('main .ln-empty').filter({ hasText: 'Nenhuma matéria da Fábrica na fila' }).first();
  await expect(vazio).toBeVisible();
  await expect(vazio).toHaveAttribute('role', 'status');
  await expect(vazio).toContainText('coleta e a redação rodam em comando próprio');
  await expect(vazio).toContainText('Matéria enviada para checagem no CMS aparece na seção');
  await expect(vazio, 'o envio pelo CMS não alimenta a fila da Fábrica').not.toContainText('enviar uma matéria para checagem');
  await expect(page.locator('main .st-empty[aria-labelledby="vazio-f"]'), 'caixa improvisada antiga').toHaveCount(0);
});

test('fila de checagem: filtro sem resultado não diz que a Fábrica não entregou nada e leva de volta à fila', async ({ page, context }) => {
  await entrar(context, 'honesto-check', 'admin');
  // nenhum spec semeia matéria da Fábrica em rascunho: este filtro não acha nada em qualquer ordem
  await page.goto('/studio/cms/checagem?status=rascunho');
  const vazio = page.locator('main .ln-empty').filter({ hasText: 'Nenhuma matéria da Fábrica com esse estado' });
  await expect(vazio).toBeVisible();
  await expect(vazio).toHaveAttribute('role', 'status');
  await expect(vazio).toContainText('O filtro de estado “Rascunho” não encontrou matéria');
  await expect(page.locator('main')).not.toContainText('não entregou rascunho nenhum');
  await expect(page.getByLabel('Estado')).toHaveValue('rascunho');
  await vazio.getByRole('link', { name: 'Limpar filtro' }).click();
  await expect(page).toHaveURL(/\/studio\/cms\/checagem$/);
  await expect(page.getByRole('heading', { name: 'Nenhuma matéria da Fábrica com esse estado' })).toHaveCount(0);
});
