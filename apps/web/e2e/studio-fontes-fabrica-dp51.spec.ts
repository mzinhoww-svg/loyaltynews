import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { entrar, enviar } from './helpers';

// DP-51 (proprietário): fontes da Fábrica. O administrador habilita com UM clique, sem revisão prévia dos termos; a ação acontece NO card (sem
// recarregar a página nem perder a posição); a observação é opcional; fonte com aviso de segurança pede confirmação; "só desabilitadas" e
// "habilitar todas desta página". A habilitação fica na trilha de auditoria editorial (quem e quando), lida pela rota de teste do build de e2e.
test.describe.configure({ mode: 'serial' });

const LIMPA = '[data-fabrica-fonte][data-habilitada="nao"]:not(:has([data-aviso-seguranca])):not(:has([data-acesso]))';
const COM_AVISO = '[data-fabrica-fonte][data-habilitada="nao"]:has([data-aviso-seguranca])';

async function auditoria(context: BrowserContext) {
  const r = await context.request.get('/api/e2e/login?auditoria=editorial');
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { itens: { at: string; userId: string | null; action: string; target: string; detail?: string }[] }).itens;
}

const idDe = async (card: Locator) => (await card.getAttribute('data-fabrica-fonte'))!;
const marca = (page: Page) => page.evaluate(() => ((window as unknown as { __semRecarga?: number }).__semRecarga = 1));
const semRecarga = (page: Page) => page.evaluate(() => (window as unknown as { __semRecarga?: number }).__semRecarga === 1);

test('um clique habilita no próprio card, sem recarregar a página e sem perder a posição; o foco vai para a mensagem do card', async ({ page, context }) => {
  await entrar(context, 'adm51', 'admin');
  await page.goto('/studio/fontes/fabrica');
  await expect(page.locator('[data-fabrica-fonte]')).toHaveCount(20);
  const card = page.locator(LIMPA).nth(6);
  const id = await idDe(card);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('heading').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await marca(page);
  const antes = await page.evaluate(() => window.scrollY);
  expect(antes, 'a página precisa estar rolada para provar que a posição fica').toBeGreaterThan(200);

  const aqui = page.locator(`[data-fabrica-fonte="${id}"]`);
  await enviar(page, aqui.getByRole('button', { name: /^Habilitar / }));
  await expect(aqui).toHaveAttribute('data-habilitada', 'sim');
  const msg = aqui.locator('[data-cartao-msg]');
  await expect(msg).toContainText('Fonte habilitada. Ficou registrado quem habilitou e quando.');
  await expect(msg).toBeFocused();
  await expect(aqui.getByRole('button', { name: /^Desabilitar / })).toBeVisible();
  await expect(aqui.locator('[data-revisao]')).toContainText('Habilitação direta');
  expect(await semRecarga(page), 'a página foi recarregada').toBe(true);
  const depois = await page.evaluate(() => window.scrollY);
  expect(Math.abs(depois - antes), `rolagem antes ${antes}, depois ${depois}`).toBeLessThanOrEqual(4);

  // ficou gravado: recarregar mostra a fonte habilitada
  await page.reload();
  await expect(page.locator(`[data-fabrica-fonte="${id}"]`)).toHaveAttribute('data-habilitada', 'sim');
});

test('a habilitação direta fica na auditoria com quem e quando, e a observação é opcional (sem mínimo)', async ({ page, context }) => {
  await entrar(context, 'adm51', 'admin');
  await page.goto('/studio/fontes/fabrica');
  const card = page.locator(LIMPA).nth(2);
  const id = await idDe(card);
  const aqui = page.locator(`[data-fabrica-fonte="${id}"]`);
  await aqui.getByText('Detalhes e observação').click();
  await aqui.getByLabel(/Observação/).fill('ok'); // 2 caracteres: sem mínimo
  const antes = Date.now();
  await enviar(page, aqui.getByRole('button', { name: /^Habilitar / }));
  await expect(aqui).toHaveAttribute('data-habilitada', 'sim');
  const trilha = (await auditoria(context)).filter((a) => a.action === 'source.enable_direct' && a.target === id);
  expect(trilha).toHaveLength(1);
  expect(trilha[0]!.userId, 'quem habilitou').toBeTruthy();
  expect(trilha[0]!.detail).toContain('observação: ok');
  expect(Math.abs(new Date(trilha[0]!.at).getTime() - antes), 'quando').toBeLessThan(120_000);
  // sem observação também vale (a anterior foi sem texto)
  const anteriores = (await auditoria(context)).filter((a) => a.action === 'source.enable_direct');
  expect(anteriores.length).toBeGreaterThanOrEqual(2);
});

test('fonte com aviso de segurança: sem confirmar o card recusa e mostra o aviso; confirmando, o administrador decide e fica registrado', async ({ page, context }) => {
  await entrar(context, 'adm51', 'admin');
  await page.goto('/studio/fontes/fabrica?estado=desabilitadas&q=');
  // procura, entre as páginas, um card com aviso (o cadastro tem fontes inacessíveis)
  let achou = page.locator(COM_AVISO).first();
  for (let p = 1; p <= 8 && (await achou.count()) === 0; p++) {
    await page.goto(`/studio/fontes/fabrica?estado=desabilitadas&pagina=${p}`);
    achou = page.locator(COM_AVISO).first();
  }
  await expect(achou, 'nenhuma fonte com aviso de segurança no cadastro de teste').toBeVisible();
  const id = await idDe(achou);
  const aqui = page.locator(`[data-fabrica-fonte="${id}"]`);
  await expect(aqui.locator('[data-aviso-seguranca]')).toContainText('Aviso de segurança');
  await enviar(page, aqui.getByRole('button', { name: /^Habilitar / }));
  await expect(aqui.locator('[data-cartao-msg]')).toContainText(/aviso de segurança|confirme/i);
  await expect(aqui).toHaveAttribute('data-habilitada', 'nao');
  await aqui.getByLabel(/Entendi o aviso de segurança/).check();
  await enviar(page, aqui.getByRole('button', { name: /^Habilitar / }));
  await expect(aqui).toHaveAttribute('data-habilitada', 'sim');
  const trilha = (await auditoria(context)).filter((a) => a.action === 'source.enable_direct' && a.target === id);
  expect(trilha[0]?.detail).toMatch(/risco aceito/);
});

test('desabilitar também é um clique no próprio card; o filtro "só desabilitadas" esconde as habilitadas', async ({ page, context }) => {
  await entrar(context, 'adm51', 'admin');
  await page.goto('/studio/fontes/fabrica');
  const habilitada = page.locator('[data-fabrica-fonte][data-habilitada="sim"]').first();
  const id = await idDe(habilitada);
  await marca(page);
  await enviar(page, page.locator(`[data-fabrica-fonte="${id}"]`).getByRole('button', { name: /^Desabilitar / }));
  await expect(page.locator(`[data-fabrica-fonte="${id}"]`)).toHaveAttribute('data-habilitada', 'nao');
  await expect(page.locator(`[data-fabrica-fonte="${id}"] [data-cartao-msg]`)).toContainText('Fonte desabilitada.');
  expect(await semRecarga(page)).toBe(true);

  await page.goto('/studio/fontes/fabrica');
  await page.getByLabel('Só desabilitadas').check();
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page).toHaveURL(/estado=desabilitadas/);
  await expect(page.locator('[data-habilitada="sim"]')).toHaveCount(0);
  expect(await page.locator('[data-fabrica-fonte]').count()).toBeGreaterThan(0);
});

test('"Habilitar todas desta página" habilita as desabilitadas sem aviso e deixa as com aviso para confirmar uma a uma', async ({ page, context }) => {
  await entrar(context, 'adm51', 'admin');
  await page.goto('/studio/fontes/fabrica?estado=desabilitadas');
  const botao = page.getByRole('button', { name: /Habilitar todas desta página \(\d+\)/ });
  const n = Number(/\((\d+)\)/.exec((await botao.textContent()) ?? '')![1]);
  expect(n).toBeGreaterThan(0);
  await enviar(page, botao);
  await expect(page.locator('main .st-alert.ok').first()).toContainText(new RegExp(`${n} habilitada\\(s\\)`));
  await page.goto('/studio/fontes/fabrica');
  expect(await page.locator('[data-fabrica-fonte][data-habilitada="sim"]').count()).toBeGreaterThanOrEqual(n);
});

test('papéis: editor-chefe habilita só com revisão (sem o caminho direto), revisor só desabilita, editor não vê nada; o lote é só do administrador', async ({ page, context }) => {
  await entrar(context, 'chefe51', 'editor_chefe');
  await page.goto('/studio/fontes/fabrica?estado=desabilitadas');
  await expect(page.getByRole('button', { name: /Habilitar todas/ })).toHaveCount(0);
  const card = page.locator(LIMPA).first();
  const id = await idDe(card);
  await enviar(page, page.locator(`[data-fabrica-fonte="${id}"]`).getByRole('button', { name: /^Habilitar / }));
  await expect(page.locator(`[data-fabrica-fonte="${id}"] [data-cartao-msg]`)).toContainText('ainda não tem revisão');
  await expect(page.locator(`[data-fabrica-fonte="${id}"]`)).toHaveAttribute('data-habilitada', 'nao');

  await entrar(context, 'rev51', 'revisor');
  await page.goto('/studio/fontes/fabrica');
  await expect(page.getByRole('button', { name: /^Habilitar / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Habilitar todas/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Desabilitar / }).first()).toBeVisible();

  await entrar(context, 'ed51', 'editor');
  await page.goto('/studio/fontes/fabrica');
  await expect(page.getByRole('button', { name: /Habilitar|Desabilitar|Registrar revisão/ })).toHaveCount(0);
});

test('limpeza: desabilita o que estes testes habilitaram (os outros testes partem das fontes desabilitadas)', async ({ context }) => {
  await entrar(context, 'adm51', 'admin');
  const lista = await context.request.get('/api/studio/editorial/sources');
  const itens = ((await lista.json()) as { items: { id: string; habilitada: boolean }[] }).items.filter((i) => i.habilitada);
  for (const i of itens) {
    const r = await context.request.post(`/api/studio/editorial/sources/${i.id}/enabled`, { data: { enabled: false } });
    expect(r.ok(), i.id).toBe(true);
  }
  const depois = ((await (await context.request.get('/api/studio/editorial/sources')).json()) as { items: { habilitada: boolean }[] }).items;
  expect(depois.filter((i) => i.habilitada)).toHaveLength(0);
});
