import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Acessibilidade das páginas de dados (Entity Intelligence e Moves) no modo api, com a meta do PM: 0 violações
 * serious/critical por página, com a contagem explícita no resultado. Roda em desktop e mobile.
 *
 * Também cobre o estado vazio honesto da empresa sem relações: o texto explica o motivo real (a fonte não afirma vínculo),
 * sem card quebrado nem promessa de "em breve".
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const ALFA = '10000000-0000-4000-8000-000000000001';
const SEM_RELACOES = '10000000-0000-4000-8000-000000000005';

const PAGINAS = [
  { nome: 'diretorio', path: '/intelligence/empresas' },
  { nome: 'empresa', path: `/intelligence/empresas/${ALFA}` },
  { nome: 'empresa-sem-relacoes', path: `/intelligence/empresas/${SEM_RELACOES}` },
  { nome: 'moves', path: '/moves' },
];

test.describe('axe nas páginas de dados: 0 serious/critical', () => {
  test.skip(mode !== 'api', 'os perfis e o diretório vêm do fake-api');

  for (const p of PAGINAS) {
    test(`${p.nome}: 0 violações serious/critical`, async ({ page }) => {
      const res = await page.goto(p.path);
      expect(res?.status(), p.path).toBe(200);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const resumo = graves.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nó(s)`);
      console.log(`axe ${p.nome}: ${graves.length} serious/critical de ${r.violations.length} violação(ões)`);
      expect(resumo, `${p.nome}: ${resumo.join(' ; ')}`).toEqual([]);
    });
  }
});

test.describe('estados vazios honestos nas páginas de dados', () => {
  test.skip(mode !== 'api', 'os perfis vêm do fake-api');

  test('data do cadastro da empresa é "Coletado em"; relação e cargo seguem "Validado em"', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    const lista = page.getByTestId('company-list');
    await expect(lista).toContainText('Coletado em');
    await expect(lista).not.toContainText('Validado em');
    // Relação tem validated_at de verdade: continua "Validado em".
    await page.goto(`/intelligence/empresas/${ALFA}`);
    await expect(page.getByTestId('relations')).toContainText('Validado em');
  });

  test('empresa sem relações explica o motivo real, sem card quebrado', async ({ page }) => {
    await page.goto(`/intelligence/empresas/${SEM_RELACOES}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('[MOCK API] Coalizão Épsilon');
    await expect(page.getByText('Nenhum vínculo publicado')).toBeVisible();
    await expect(page.getByText('Ausência aqui não prova inexistência')).toBeVisible();
    // Sem "executivo": há pessoas sem cargo declarado e cargos inferidos que não são publicados.
    await expect(page.getByText('Nenhum cargo declarado com fonte oficial foi publicado para esta empresa')).toBeVisible();
    await expect(page.getByText(/executivos verificados/)).toHaveCount(0);
    // Nada de tabela vazia pendurada nem card placeholder.
    await expect(page.getByTestId('relations')).toHaveCount(0);
  });

  test('Moves com dado publicado lista os Move; sem dado, o vazio é explicado (coberto no modo vazio)', async ({ page }) => {
    await page.goto('/moves');
    await expect(page.getByTestId('moves-list')).toBeVisible();
    await expect(page.getByTestId('moves-empty-honest')).toHaveCount(0);
  });
});
