import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Importação auditada da folha do leitor 2 (Studio 2; PM-2026-11-23-C e -E) sobre as rotas reais da Editorial (ft/editorial 264e7bd).
// Roda DEPOIS de studio-y-piloto (nome do arquivo): lá a1 foi mapeada e lida pelo leitor 1. Aqui a4 é mapeada pela API (artigo MOCK da seed).
test.describe.configure({ mode: 'serial' });

const CAB = 'materia,trecho,tipo,gravidade,evidencia_id,nota,fatos_nas_evidencias,tom,nada_inventado,veredito';
const FOLHA = [CAB, 'a1,SEGREDO trecho do QA 3,nome,media,ev_1,NOTA SECRETA,sim,sim,sim,aprovado', 'a4,,,,,,sim,sim,sim,aprovado'].join('\n');
const OUTRA = [CAB, 'a1,outro texto do QA 3,nome,media,,,sim,sim,sim,aprovado', 'a4,,,,,,sim,sim,sim,aprovado'].join('\n');
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();

async function enviarFolha(page: Page, conteudo: string, passo: 'validar' | 'importar', confirmar = false) {
  await page.goto('/studio/piloto/importar');
  await page.locator('#arquivo').setInputFiles({ name: 'folha-qa3.csv', mimeType: 'text/csv', buffer: Buffer.from(conteudo, 'utf8') });
  if (confirmar) await page.getByRole('form', { name: 'Importar folha do leitor 2' }).getByRole('checkbox').check();
  await enviar(page, page.getByRole('button', { name: passo === 'validar' ? 'Validar e registrar a folha' : 'Importar', exact: true }));
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  expect((await ctx.request.get('/api/e2e/login?seed=piloto')).ok()).toBe(true);
  await entrar(ctx, 'pil-chefe', 'editor_chefe');
  const m = await api(ctx, 'POST', '/api/studio/editorial/piloto/mapa', { a4: 'piloto-e2e-a4' });
  expect([201, 409]).toContain(m.status);
  await ctx.close();
});

test('RBAC: editor e revisor não importam', async ({ page, context }) => {
  for (const [u, papel] of [['imp-ed', 'editor'], ['imp-rev', 'revisor']] as const) {
    await entrar(context, u, papel);
    await page.goto('/studio/piloto/importar');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  }
});

test('validar: registra o hash no primeiro envio e mostra prévia SEM conteúdo; axe', async ({ page, context }) => {
  await entrar(context, 'pil-chefe', 'editor_chefe');
  await enviarFolha(page, FOLHA, 'validar');
  await sucesso(page, 'registrada');
  const main = page.locator('main');
  await expect(main).toContainText('a1: 1 linha(s)');
  await expect(main).toContainText('a4: 1 linha(s)');
  for (const segredo of ['SEGREDO', 'NOTA SECRETA']) await expect(main).not.toContainText(segredo);
  await expect(page.locator('tr[data-materia="a1"] [data-folha]')).not.toHaveAttribute('data-folha', '');
  await expect(page.locator('[data-aviso="cegueira"]')).toBeVisible();
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test('folha diferente da registrada é recusada (FOLHA_DIFERENTE); linha inválida não importa nada', async ({ page, context }) => {
  await entrar(context, 'pil-chefe', 'editor_chefe');
  await enviarFolha(page, OUTRA, 'validar');
  await erro(page, /não registrada/);
  await enviarFolha(page, [CAB, 'a1,ab,nome,media,,,sim,sim,sim,bloqueado'].join('\n'), 'importar', true);
  await erro(page, /trecho de 3 a 500|não registrada/);
  expect((await api(context, 'GET', '/api/studio/editorial/piloto')).body.items.find((i: { materia: string }) => i.materia === 'a1').leituras.leitor2).toBe(false);
});

test('importar espera a leitura do leitor 1 (a4 pendente): nada é gravado; depois de ler a4, importa tudo; origem visível', async ({ page, context }) => {
  await entrar(context, 'pil-chefe', 'editor_chefe');
  await enviarFolha(page, FOLHA, 'importar', true);
  await erro(page, 'registre antes a sua leitura de a4');
  const antes = await api(context, 'GET', '/api/studio/editorial/piloto');
  expect(antes.body.items.find((i: { materia: string }) => i.materia === 'a1').leituras.leitor2).toBe(false); // tudo ou nada

  const l1 = await api(context, 'POST', '/api/studio/editorial/piloto/a4/leitura', { leitor: 1, achados: [], checklist: { fatosNasEvidencias: true, tom: true, nadaInventado: true }, veredito: 'aprovado' });
  expect(l1.status).toBe(201);
  await enviarFolha(page, FOLHA, 'importar', true);
  await sucesso(page, /Importadas como leitura do leitor 2 \(QA 3\): a1 .*a4/);
  await expect(page.locator('main')).not.toContainText('SEGREDO');

  await page.goto('/studio/piloto/a1');
  const l2 = page.locator('[data-leitura="2"]');
  await expect(l2).toContainText('SEGREDO trecho do QA 3'); // o leitor 1 já registrou a dele em a1: agora vê
  await expect(l2.locator('[data-origem="importacao"]')).toContainText('importado por');
  await expect(l2.locator('[data-origem="importacao"]')).toContainText('da folha de QA 3');
  await expect(l2.locator('[data-origem="importacao"]')).toContainText('folha-qa3.csv');
  // imutável: a mesma folha de novo é recusada
  await enviarFolha(page, FOLHA, 'importar', true);
  await erro(page, 'Nada foi importado');
});
