import { expect, test } from '@playwright/test';
import path from 'node:path';

const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock';
const SHOTS = path.resolve(import.meta.dirname, '..', 'screenshots', mode);

interface PageSpec {
  name: string;
  path: string;
  /** Texto que deve aparecer no estado vazio (modo empty). */
  empty?: RegExp;
}

const PAGES: PageSpec[] = [
  { name: 'home', path: '/', empty: /Em breve: primeiras matérias/ },
  { name: 'noticias', path: '/noticias', empty: /Em breve: primeiras matérias/ },
  { name: 'flash', path: '/flash', empty: /Loyalty Flash em breve/ },
  { name: 'analises', path: '/analises', empty: /Análises em breve/ },
  { name: 'entrevistas', path: '/entrevistas', empty: /Entrevistas em breve/ },
  { name: 'opiniao', path: '/opiniao', empty: /Opinião em breve/ },
  { name: 'em-alta', path: '/em-alta', empty: /Ranking em formação/ },
  { name: 'busca', path: '/busca' },
  { name: 'agenda', path: '/agenda', empty: /Nenhum evento verificado por enquanto/ },
  { name: 'moves', path: '/moves', empty: /Em breve: primeiras movimentações confirmadas/ },
  { name: 'intelligence', path: '/intelligence' },
  { name: 'intelligence-empresas', path: '/intelligence/empresas', empty: /Em breve: primeiros perfis verificados/ },
  { name: 'intelligence-pessoas', path: '/intelligence/pessoas', empty: /Em breve: primeiros perfis verificados/ },
  { name: 'midia-kit', path: '/midia-kit' },
  { name: 'the-loyal', path: '/the-loyal', empty: /ainda não está aberto para inscrições/ },
  { name: 'podcast', path: '/podcast', empty: /Loyalty Talks em breve/ },
  { name: 'indicadores', path: '/indicadores', empty: /Market Data em breve/ },
  { name: 'sobre', path: '/sobre' },
  { name: 'metodologia', path: '/metodologia' },
  { name: 'politica-editorial', path: '/politica-editorial' },
  { name: 'correcoes', path: '/correcoes' },
  { name: 'privacidade', path: '/privacidade' },
  { name: 'termos', path: '/termos' },
  { name: 'publicidade', path: '/publicidade' },
  { name: 'contato', path: '/contato' },
];

const EDITORIAS = [
  'mercado-e-negocios', 'programas-de-fidelidade', 'pontos-e-milhas', 'bancos-e-cartoes', 'varejo-e-cashback',
  'travel-e-hospitality', 'loyaltytech-e-ia', 'crm-e-cx', 'global-loyalty', 'regulacao-e-dados',
].map((slug) => ({ name: `editoria-${slug}`, path: `/editoria/${slug}`, empty: /Em breve: primeiras matérias/ }) as PageSpec);

for (const p of [...PAGES, ...EDITORIAS]) {
  test(`página ${p.name} renderiza sem erros e gera screenshot`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    const res = await page.goto(p.path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page).toHaveTitle(/Loyalty News/);
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toHaveCount(1);

    if (mode === 'empty' && p.empty) await expect(page.getByText(p.empty).first()).toBeVisible();
    if (mode === 'mock') await expect(page.getByText(/MOCK — conteúdo sintético/)).toBeVisible();

    // Sem rolagem horizontal (responsivo).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'rolagem horizontal').toBeLessThanOrEqual(1);

    expect(errors, errors.join('\n')).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-${p.name}.png`), fullPage: true });
  });
}
