import { expect, test, type Page } from '@playwright/test';
import { entrar } from './helpers';

// CONTRATO DE LEITURA DO STUDIO (fast-track, item E): as 20 telas de leitura abrem com o backend real de e2e
// (Better Auth + PGlite, os mesmos handlers da API) e nenhuma delas devolve 5xx, quebra no render ou cai no
// error boundary. Cada tela mostra a lista com as linhas OU o vazio honesto do design system (role=status).
// O contrato de campos (o que cada item precisa ter) esta no unitario app/api/_lib/studio-contrato-leitura.test.ts.

const TELAS = [
  '/studio/agenda',
  '/studio/auditoria',
  '/studio/campanhas',
  '/studio/cms/checagem',
  '/studio/cms/correcoes',
  '/studio/cms',
  '/studio/cms/pautas',
  '/studio/correcoes-titular',
  '/studio/creative',
  '/studio/crm',
  '/studio/decisoes',
  '/studio/entidades',
  '/studio/fontes',
  '/studio/midia',
  '/studio/organogramas',
  '/studio/piloto',
  '/studio/piloto/violacoes',
  '/studio/seo',
  '/studio/social',
  '/studio/watchlists',
] as const;

function coletar5xx(page: Page): string[] {
  const falhas: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 500) falhas.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return falhas;
}

test('as 20 telas de leitura: 200, zero 5xx, titulo e conteudo (linhas ou vazio honesto)', async ({ page, context }) => {
  await entrar(context, 'contrato-leitura', 'admin');
  const problemas: string[] = [];

  for (const rota of TELAS) {
    const cincoxx = coletar5xx(page);
    const resposta = await page.goto(rota);
    const status = resposta?.status() ?? 0;
    if (status >= 500 || status === 0) problemas.push(`${rota}: status ${status}`);

    const h1 = await page.locator('h1').count();
    if (h1 === 0) problemas.push(`${rota}: sem h1`);

    // Error boundary e frase de crash nao podem aparecer numa leitura normal.
    const texto = await page.locator('body').innerText();
    if (/Algo deu errado|Não foi possível carregar|Application error/i.test(texto)) problemas.push(`${rota}: error boundary na tela`);

    // Conteudo: linha de dado, painel, ou o vazio honesto (EmptyState role=status, st-hint ou st-empty).
    const linhas = await page.locator('main tbody tr, main ul li, main article, main .st-card, main .ln-empty, main .st-empty, main .st-hint').count();
    if (linhas === 0) problemas.push(`${rota}: sem linha, painel ou vazio honesto`);

    if (cincoxx.length > 0) problemas.push(`${rota}: 5xx ${cincoxx.join(', ')}`);
  }

  expect(problemas, problemas.join('\n')).toEqual([]);
});
