import { expect, test, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Pauta AUTORAL (DP-29): POST/GET /api/studio/editorial/pautas, sessão real. O worker não roda no e2e: a pauta enviada fica "na fila";
// os estados aprovada/bloqueada vêm de uma semente de teste (MOCK, trilha de auditoria) com o formato que o worker grava.
test.describe.configure({ mode: 'serial' });

const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

interface Fonte {
  id: string;
  kind: string;
  host: string;
  pathPrefix: string | null;
  habilitada: boolean;
}

test('sem fonte primária habilitada: o formulário não aparece e a tela manda para Fontes da Fábrica', async ({ page, context }) => {
  await entrar(context, 'chefe', 'editor_chefe');
  const fontes = (await api(context, 'GET', '/api/studio/editorial/sources')).body.items as Fonte[];
  for (const f of fontes.filter((x) => x.habilitada)) await api(context, 'POST', `/api/studio/editorial/sources/${f.id}/enabled`, { enabled: false });
  await page.goto('/studio/cms/pautas');
  await expect(page.getByRole('heading', { level: 1, name: 'Pauta autoral' })).toBeVisible();
  await expect(page.locator('[data-aviso="autoral"]')).toContainText('Conteúdo autoral da Redação Loyalty News');
  await expect(page.getByRole('heading', { name: 'Nenhuma pauta' })).toBeVisible();
  await expect(page.locator('[data-sem-fontes]')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Nova pauta autoral' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Fontes da Fábrica' })).toBeVisible();
  // não há botão de publicar em lugar nenhum
  await expect(page.getByRole('button', { name: /publicar/i })).toHaveCount(0);
});

test('revisor acompanha mas não escreve; leitor não acessa a lista', async ({ page, context }) => {
  await entrar(context, 'rui', 'revisor');
  await page.goto('/studio/cms/pautas');
  await expect(page.getByText('Seu papel só acompanha as pautas')).toBeVisible();
  const post = await api(context, 'POST', '/api/studio/editorial/pautas', {});
  expect(post.status).toBe(403);
});

test('habilitada uma fonte primária: envia a pauta, vê na fila, repetir o id é recusado e o Backend recusa âncora fora do cadastro', async ({ page, context }) => {
  // revisão dos termos (revisor) e habilitação (chefia) de uma fonte primária do cadastro, pelas rotas reais
  await entrar(context, 'rui', 'revisor');
  const azulRev = await api(context, 'POST', '/api/studio/editorial/sources/azul-ri/review', {
    sourceId: 'azul-ri', termsStatus: 'approved', termsNote: 'Termos oficiais lidos em 23/11: permitem leitura para análise.', urlVerified: true, robotsChecked: true, paywall: 'none',
  });
  expect([200, 201], JSON.stringify(azulRev.body)).toContain(azulRev.status);
  await entrar(context, 'chefe', 'editor_chefe');
  const hab = await api(context, 'POST', '/api/studio/editorial/sources/azul-ri/enabled', { enabled: true });
  expect(hab.status, JSON.stringify(hab.body)).toBe(200);
  const fontes = (await api(context, 'GET', '/api/studio/editorial/sources')).body.items as Fonte[];
  const azul = fontes.find((f) => f.id === 'azul-ri')!;
  expect(azul.habilitada).toBe(true);
  const base = `https://${azul.host}${azul.pathPrefix ?? ''}`.replace(/\/$/, '');

  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/cms/pautas');
  await expect(page.locator('[data-sem-fontes]')).toHaveCount(0);
  const form = page.getByRole('form', { name: 'Nova pauta autoral' });
  await expect(form).toBeVisible();

  // validação local diz o campo (sem ir ao Backend)
  await enviar(page, form.getByRole('button', { name: 'Registrar pauta na fila' }));
  await erro(page, /Título/);

  const preencher = async (pagina: string[]) => {
    await page.getByLabel('Título (10 a 140 caracteres)').fill('Como a Azul reorganizou seus comunicados de fidelidade');
    await page.getByLabel('Ângulo (20 a 600 caracteres)').fill('Explica, a partir dos comunicados oficiais da Azul, o que mudou e o que não mudou.');
    await page.locator('#formato').selectOption('explicador');
    await page.locator('#editoria').selectOption('programas');
    for (const [i, u] of pagina.entries()) await page.locator(`#url-${i}`).fill(u);
  };
  // âncora de outro host: recusada antes de enviar
  await preencher([`${base}/a`, 'https://outro.example.com/b']);
  await enviar(page, form.getByRole('button', { name: 'Registrar pauta na fila' }));
  await erro(page, /Âncora 2/);
  // uma âncora só
  await preencher([`${base}/a`]);
  await enviar(page, form.getByRole('button', { name: 'Registrar pauta na fila' }));
  await erro(page, /há 1/);

  await preencher([`${base}/a`, `${base}/b`]);
  await enviar(page, form.getByRole('button', { name: 'Registrar pauta na fila' }));
  await sucesso(page, 'registrada na fila');
  const linha = page.locator('[data-pauta="como-a-azul-reorganizou-seus-comunicados-de-fidelidade"]');
  await expect(linha).toHaveAttribute('data-estado', 'fila');
  await expect(linha).toContainText('Na fila');
  await expect(linha).toContainText(`${base}/a`);
  await expect(linha.getByRole('link')).toHaveCount(0); // sem matéria ainda

  // mesma pauta de novo: 409 do Backend aparece como veio
  await preencher([`${base}/a`, `${base}/b`]);
  await enviar(page, form.getByRole('button', { name: 'Registrar pauta na fila' }));
  await erro(page, /já existe pauta/i);

  // o Backend recusa âncora fora das fontes primárias do cadastro mesmo se o cliente pular a validação
  const burla = await api(context, 'POST', '/api/studio/editorial/pautas', {
    id: 'pauta-fora-do-cadastro', titulo: 'Pauta com âncora fora do cadastro', angulo: 'Pauta que tenta ancorar em páginas sem fonte primária.', formato: 'analise', editoria: 'pontos',
    ancoras: ['https://blog.example.com/a', 'https://blog.example.com/b'],
  });
  expect(burla.status).toBe(400);
  expect(burla.body.error.code).toBe('INVALID_INPUT');
});

test('estados aprovada e bloqueada, com link para a revisão e os motivos do bloqueio', async ({ page, context }) => {
  const sem = await context.request.get('/api/e2e/login?seed=pautas');
  expect(sem.ok()).toBe(true);
  await entrar(context, 'rui', 'revisor');
  await page.goto('/studio/cms/pautas');
  const aprovada = page.locator('[data-pauta="pauta-e2e-aprovada"]');
  await expect(aprovada).toHaveAttribute('data-estado', 'aprovada');
  await expect(aprovada).toContainText('Aprovada (matéria na fila de revisão)');
  await expect(aprovada.getByRole('link', { name: 'Abrir na fila de revisão' })).toHaveAttribute('href', /\/studio\/cms\/checagem\/aut_e2e_aprovada/);
  const bloqueada = page.locator('[data-pauta="pauta-e2e-bloqueada"]');
  await expect(bloqueada).toHaveAttribute('data-estado', 'bloqueada');
  await expect(bloqueada.getByRole('list', { name: 'Bloqueios de pauta-e2e-bloqueada' })).toContainText('autoral_needs_anchors');
  await expect(bloqueada.getByRole('list', { name: 'Achados de pauta-e2e-bloqueada' })).toContainText('âncora sem evidência coletada');
  await expect(bloqueada.getByRole('link')).toHaveCount(0);
});
