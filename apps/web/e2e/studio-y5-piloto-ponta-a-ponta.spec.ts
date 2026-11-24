import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Linha 13 (proximas-tarefas-2026-11-24-0920): ponta a ponta do piloto no build da int/019.
// leitura do editor-chefe (leitor 1) → exportação CSV em /studio/piloto/planilha → cabeçalho coluna a coluna = PILOT_SHEET_COLUMNS (31) + as 7 do Studio
// → o avaliador do AgentOps (packages/agents/bin/avaliar-piloto.mjs --csv, sem rede, sem banco) ACEITA o arquivo.
// Dados MOCK: artigos sampleArticle e linhas da trilha da seed ?seed=piloto e ?seed=piloto-violacoes. Roda isolado ou depois dos outros specs do piloto.
test.describe.configure({ mode: 'serial' });

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const AVALIADOR = join(RAIZ, 'packages/agents/bin/avaliar-piloto.mjs');
// PILOT_SHEET_COLUMNS lido do mesmo src/pilot.ts que o avaliador importa (o índice do @ln/agents carrega JSON sem import attribute, que o Playwright não aceita)
const PILOT_SHEET_COLUMNS = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(join(RAIZ, 'packages/agents/src/pilot.ts')).href)}); console.log(JSON.stringify(m.PILOT_SHEET_COLUMNS));`], { encoding: 'utf8' }),
) as string[];
const EXTRAS = (JSON.parse(readFileSync(join(RAIZ, 'packages/agents/fixtures/pilot-csv-consumers.json'), 'utf8')) as { studio_extras: { columns: string[] } }).studio_extras.columns;

/** Parse RFC 4180 mínimo (aspas, vírgula e quebra entre aspas), só para o teste comparar colunas. */
function csv(texto: string): string[][] {
  const out: string[][] = [];
  let linha: string[] = [];
  let cel = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; } else if (c === '"') aspas = false; else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(cel); cel = ''; }
    else if (c === '\n') { linha.push(cel); out.push(linha); linha = []; cel = ''; }
    else if (c !== '\r') cel += c;
  }
  if (cel || linha.length) { linha.push(cel); out.push(linha); }
  return out;
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  for (const s of ['piloto', 'piloto-violacoes']) expect((await ctx.request.get(`/api/e2e/login?seed=${s}`)).ok(), `seed ${s}`).toBe(true);
  await entrar(ctx, 'pil-chefe', 'editor_chefe');
  const mapa = await api(ctx, 'POST', '/api/studio/editorial/piloto/mapa', { a1: 'piloto-e2e-a1' });
  expect([201, 409]).toContain(mapa.status); // 409 = já fixado por outro spec do piloto (o mapa é imutável)
  await ctx.close();
});

test('acesso à exportação: só admin e editor-chefe (403 para editor, revisor, comercial e leitor)', async ({ context }) => {
  for (const [u, papel] of [['pp-ed', 'editor'], ['pp-rev', 'revisor'], ['pp-com', 'comercial'], ['pp-lei', 'leitor']] as const) {
    await entrar(context, u, papel);
    const r = await context.request.get('/studio/piloto/planilha');
    expect(r.status(), papel).toBe(403);
    expect(await r.text()).not.toContain('task_id');
  }
  for (const [u, papel] of [['pp-adm', 'admin'], ['pil-chefe', 'editor_chefe']] as const) {
    await entrar(context, u, papel);
    expect((await context.request.get('/studio/piloto/planilha')).status(), papel).toBe(200);
  }
});

test('leitura do editor-chefe → CSV com as colunas do AgentOps, coluna a coluna → avaliar-piloto --csv aceita', async ({ page, context }) => {
  await entrar(context, 'pil-chefe', 'editor_chefe');
  // 1) leitura do leitor 1 em a1, pela tela (se outro spec já leu, a leitura é imutável e fica a existente)
  await page.goto('/studio/piloto/a1');
  if (await page.getByRole('form', { name: 'Registrar leitura' }).count()) {
    await page.getByLabel('Trecho').first().fill('afirmação MOCK');
    await page.locator('#tipo0').selectOption('nome');
    for (const n of ['fatosNasEvidencias', 'tom', 'nadaInventado']) await page.locator(`input[name="${n}"]`).check();
    await page.locator('input[name="veredito"][value="aprovado"]').check();
    await enviar(page, page.getByRole('button', { name: 'Registrar leitura' }));
  }
  await expect(page.locator('[data-leitura="1"]')).toBeVisible();

  // 2) exportação pela tela: o botão aponta para a rota de download
  await page.goto('/studio/piloto');
  await expect(page.locator('[data-exportar]')).toHaveAttribute('href', '/studio/piloto/planilha');
  const r = await context.request.get('/studio/piloto/planilha');
  expect(r.status()).toBe(200);
  const texto = await r.text();
  expect(texto.charCodeAt(0)).toBe(0xfeff); // BOM, como o avaliador espera do export do Studio
  const linhas = csv(texto.slice(1).trimEnd());
  const cab = linhas[0]!;

  // 3) cabeçalho coluna a coluna: as 31 do AgentOps na ordem, depois exatamente as 7 do Studio
  expect(PILOT_SHEET_COLUMNS).toHaveLength(31);
  expect(cab).toHaveLength(31 + 7);
  PILOT_SHEET_COLUMNS.forEach((c, i) => expect(cab[i], `coluna ${i + 1}`).toBe(c));
  expect(cab.slice(31)).toEqual(EXTRAS);
  for (const l of linhas.slice(1)) expect(l, 'toda linha com o mesmo número de colunas do cabeçalho').toHaveLength(cab.length);
  const a1 = linhas.find((l) => l[0] === 'mock-a1-review')!;
  expect(a1[cab.indexOf('materia')]).toBe('a1');
  expect(a1[cab.indexOf('leitor1_veredito')]).not.toBe('');
  expect(a1[cab.indexOf('unsupported_facts')]).toMatch(/^\d+$/);

  // 4) o avaliador do AgentOps aceita o arquivo (o veredito depende dos dados MOCK; o que se exige é que o CSV seja lido sem erro)
  const dir = mkdtempSync(join(tmpdir(), 'ln-piloto-'));
  const arq = join(dir, 'piloto-planilha.csv');
  writeFileSync(arq, texto, 'utf8');
  let saida: string;
  let erro = '';
  try {
    saida = execFileSync(process.execPath, [AVALIADOR, '--csv', arq, '--json'], { cwd: RAIZ, encoding: 'utf8' });
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string };
    saida = x.stdout ?? '';
    erro = x.stderr ?? '';
  }
  expect(erro, 'o avaliador não pode recusar o CSV').not.toMatch(/avaliar-piloto:/);
  const ev = JSON.parse(saida) as { veredito: string; linhas: number; overall: string };
  expect(ev.linhas).toBe(linhas.length - 1);
  expect(['APROVADO', 'REPROVADO', 'INVÁLIDO', 'PARADO', 'INCONCLUSIVO']).toContain(ev.veredito);
  test.info().annotations.push({ type: 'avaliar-piloto', description: `${ev.veredito} (${ev.overall}), ${ev.linhas} linhas` });
});
