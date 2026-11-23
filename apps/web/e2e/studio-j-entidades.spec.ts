import { expect, test, type Page } from '@playwright/test';
import { entrar } from './helpers';

// Entity Intelligence sobre as ROTAS do Backend (/api/studio/intelligence/**), com dados MOCK semeados pelas funções reais do pacote
// (processObservation, addOrgRelation): cargo oficial, cargo secundário "a confirmar", relação e um Move detectado com antes e depois.
// O nome do arquivo o põe DEPOIS de studio-intelligence.spec.ts, que espera o banco de Intelligence ainda vazio.
test.describe.configure({ mode: 'serial' });

const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

let alfa = '';
let beta = '';
let pessoa = '';

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const r = await ctx.request.get('/api/e2e/login?seed=intelligence');
  expect(r.ok(), `seed do Intelligence: ${r.status()}`).toBe(true);
  ({ alfa, beta, pessoa } = (await r.json()) as { alfa: string; beta: string; pessoa: string });
  await ctx.close();
});

test('só editor ou superior: leitor e comercial não entram', async ({ page, context }) => {
  for (const role of ['leitor', 'comercial']) {
    await entrar(context, 'x', role);
    await page.goto('/studio/entidades');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  }
});

test('busca acha a empresa e o executivo; a empresa mostra pessoas e cargos com nível, fonte, link e data', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/entidades?q=MOCK');
  await page.getByRole('list', { name: 'Empresas encontradas' }).getByRole('link', { name: 'MOCK Alfa Fidelidade S.A.' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'MOCK Alfa Fidelidade S.A.' })).toBeVisible();
  await expect(page.getByText('Ausência de registro não prova inexistência.').first()).toBeVisible();

  const tabela = page.getByRole('table', { name: 'Pessoas e cargos' });
  const crm = tabela.locator('tr[data-cargo="Diretora de CRM"]');
  await expect(crm).toContainText('MOCK Ana Souza');
  await expect(crm).toHaveAttribute('data-nivel', 'oficial');
  await expect(crm.getByText('Oficial', { exact: true })).toBeVisible();
  // fonte com link e data, marcada MOCK; nunca o trecho da página
  const fonte = crm.getByRole('link', { name: /MOCK RI Alfa/ });
  await expect(fonte).toHaveAttribute('href', /^https:\/\/mock\.invalid\/ri-alfa-/);
  await expect(fonte).toContainText('· MOCK');
  await expect(page.getByText('MOCK trecho')).toHaveCount(0);
  await expect(tabela.locator('tr[data-cargo="Diretor Financeiro"]')).toHaveAttribute('data-nivel', 'oficial');
  // o cargo de fonte secundária aparece como a confirmar, nunca como oficial
  const carlaLinha = tabela.locator('tr[data-cargo="Gerente de Dados"]');
  await expect(carlaLinha).toHaveAttribute('data-nivel', 'secundaria');
  await expect(carlaLinha).toContainText('Secundária — a confirmar');
});

test('lista de cargos com nível da fonte: oficial, secundária e filtro', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/entidades?nivel=secondary');
  const tabela = page.getByRole('table', { name: 'Cargos' });
  await expect(tabela.locator('tr[data-nivel="secundaria"]')).toHaveCount(2);
  await expect(tabela.locator('tr[data-nivel="oficial"]')).toHaveCount(0);
  await expect(tabela.locator('tr[data-status="to_confirm"]')).toHaveCount(2);
  await page.goto('/studio/entidades?nivel=official');
  await expect(page.getByRole('table', { name: 'Cargos' }).locator('tr[data-nivel="oficial"]')).not.toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Cargos' }).locator('tr[data-nivel="secundaria"]')).toHaveCount(0);
  await page.goto('/studio/entidades?cq=Diretor%20Financeiro');
  await expect(page.getByRole('table', { name: 'Cargos' }).locator('tr[data-cargo="Diretor Financeiro"]')).toBeVisible();
});

test('fila a confirmar: confirmar com a página oficial vira fato; recusa LinkedIn; descartar exige motivo', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/entidades');
  const fila = page.locator('[data-secao="a-confirmar"]');
  const carla = () => fila.locator('li[data-a-confirmar="Gerente de Dados"]');
  const eva = () => fila.locator('li[data-a-confirmar="Gerente de Parcerias"]');
  await expect(carla()).toContainText('Secundária — a confirmar');
  await expect(carla().getByRole('link', { name: /MOCK LinkedIn/ })).toHaveAttribute('href', /linkedin-alfa/);

  // LinkedIn nunca confirma; sem https também não
  await carla().getByLabel(/Página oficial que sustenta/).fill('https://www.linkedin.com/in/carla');
  await carla().getByRole('button', { name: 'Confirmar com a página oficial' }).click();
  await expect(page.locator('main .st-alert.err').first()).toBeVisible();
  await page.goto('/studio/entidades');
  await carla().getByLabel(/Página oficial que sustenta/).fill('http://mock.invalid/ri-alfa/diretoria');
  await carla().getByRole('button', { name: 'Confirmar com a página oficial' }).click();
  await expect(page.locator('main .st-alert.err').first()).toBeVisible();

  // descarte sem motivo suficiente é recusado; com motivo, sai da fila
  await page.goto('/studio/entidades');
  await eva().getByLabel(/Motivo do descarte/).fill('x');
  await eva().getByRole('button', { name: 'Descartar' }).click();
  await expect(page.locator('main .st-alert.err').first()).toBeVisible();
  await page.goto('/studio/entidades');
  await eva().getByLabel(/Motivo do descarte/).fill('Perfil desatualizado: a pessoa saiu da empresa.');
  await eva().getByRole('button', { name: 'Descartar' }).click();
  await sucesso(page, 'Cargo descartado');
  await expect(page.locator('li[data-a-confirmar="Gerente de Parcerias"]')).toHaveCount(0);

  // confirma Carla com a página oficial do mesmo site da fonte oficial cadastrada: vira oficial e deixa a fila
  await carla().getByLabel(/Página oficial que sustenta/).fill('https://mock.invalid/ri-alfa/diretoria');
  await carla().getByRole('button', { name: 'Confirmar com a página oficial' }).click();
  await sucesso(page, 'Cargo confirmado com a página oficial');
  await expect(page.locator('li[data-a-confirmar="Gerente de Dados"]')).toHaveCount(0);
  await expect(page.locator('[data-vazio="a-confirmar"]')).toBeVisible();
  // na empresa ela agora é oficial; confirmar não criou Move
  await page.goto(`/studio/entidades/${alfa}`);
  await expect(page.getByRole('table', { name: 'Pessoas e cargos' }).locator('tr[data-cargo="Gerente de Dados"]')).toHaveAttribute('data-nivel', 'oficial');
  await expect(page.locator('[data-move]')).toHaveCount(1);
});

test('relações com a evidência de cada uma', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto(`/studio/entidades/${alfa}`);
  const linha = page.getByRole('table', { name: 'Relações' }).locator('tr[data-relacao="partner_of"]');
  await expect(linha).toContainText('Parceria com');
  await expect(linha.getByRole('link', { name: 'MOCK Beta Cartões Ltda' })).toHaveAttribute('href', `/studio/entidades/${beta}`);
  await expect(linha).toContainText('em vigor');
  await expect(linha.getByRole('link', { name: /MOCK RI Alfa/ })).toContainText('MOCK');
  // a outra ponta também existe, sem relação inventada do lado dela além da mesma aresta
  await page.goto(`/studio/entidades/${beta}`);
  await expect(page.getByRole('heading', { level: 1, name: 'MOCK Beta Cartões Ltda' })).toBeVisible();
});

test('executivo: histórico de cargos com o nível e a fonte de cada um', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto(`/studio/entidades/pessoa/${pessoa}`);
  await expect(page.getByRole('heading', { level: 1, name: 'MOCK Ana Souza' })).toBeVisible();
  const tabela = page.getByRole('table', { name: 'Cargos' });
  await expect(tabela.locator('tr[data-cargo="Diretora de Marketing"]')).toContainText('2026-11-05'); // fechado quando o novo abriu
  await expect(tabela.locator('tr[data-cargo="Diretora de CRM"]')).toContainText('em vigor');
  await expect(tabela.locator('tr[data-nivel="oficial"]')).toHaveCount(2);
  expect((await page.goto('/studio/entidades/pessoa/nao-e-uuid'))?.status()).toBe(404);
});

test('Move pendente mostra antes e depois com fonte e data; editor confirma; some da fila', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/entidades');
  const move = page.locator('[data-move][data-kind="title_change"]');
  await expect(move).toContainText('MOCK Ana Souza');
  await expect(move).toContainText('Mudança de cargo');
  await expect(move).toContainText('data efetiva não informada pela fonte');
  const antes = move.locator('[data-lado="antes"]');
  const depois = move.locator('[data-lado="depois"]');
  await expect(antes).toContainText('Diretora de Marketing');
  await expect(depois).toContainText('Diretora de CRM');
  await expect(antes.getByRole('link')).toHaveAttribute('href', /ri-alfa-1/);
  await expect(depois.getByRole('link')).toHaveAttribute('href', /ri-alfa-2/);
  await expect(move.getByText('MOCK').first()).toBeVisible();

  // a empresa mostra o mesmo Move, restrito a ela
  await page.goto(`/studio/entidades/${alfa}`);
  await expect(page.locator('[data-move]')).toHaveCount(1);

  await page.goto('/studio/entidades');
  await page.getByRole('button', { name: 'Confirmar MOCK Ana Souza' }).click();
  await sucesso(page, 'Movimentação confirmada');
  await expect(page.locator('[data-vazio="moves"]')).toBeVisible();
});
