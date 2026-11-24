import { expect, type Page } from '@playwright/test';
import { enviar } from './helpers';

/**
 * Anexa o arquivo de um criativo e envia, sem corrida (ressalva P3 do QA 7, 0d630e7: "Escolha o arquivo do criativo." quando o arquivo
 * era anexado a um formulário ainda não hidratado ou prestes a ser remontado). Sem nova tentativa: espera estados observáveis.
 *  1. o formulário do criativo está hidratado pelo React (a ação de servidor está ligada ao elemento);
 *  2. anexa e confirma que ESTE input guarda exatamente o arquivo pedido;
 *  3. confirma de novo, logo antes do clique, que o input continua com o arquivo (nada o remontou).
 */
export async function anexarEEnviar(page: Page, criativoId: string, arquivo: { name: string; mimeType: string; buffer: Buffer }) {
  const input = page.getByLabel(`Arquivo de ${criativoId}`);
  const botao = page.getByRole('button', { name: `Enviar arquivo de ${criativoId}` });
  await expect(input).toBeVisible();
  await expect
    .poll(() => input.evaluate((el) => { const f = el.closest('form'); return !!f && Object.keys(f).some((k) => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$')); }), { message: `formulário de ${criativoId} hidratado` })
    .toBe(true);
  await input.setInputFiles(arquivo);
  const nomeNoInput = () => input.evaluate((el) => { const fs = (el as HTMLInputElement).files; return fs && fs.length === 1 ? fs[0]!.name : null; });
  await expect.poll(nomeNoInput, { message: `arquivo anexado em ${criativoId}` }).toBe(arquivo.name);
  expect(await nomeNoInput(), `o input de ${criativoId} foi remontado antes do envio`).toBe(arquivo.name);
  await enviar(page, botao);
}
