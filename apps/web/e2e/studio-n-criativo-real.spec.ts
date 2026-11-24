import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { definirFlag, entrar, enviar } from './helpers';

// Criativo real ponta a ponta no Studio (Studio 3): arquivo enviado e medido no servidor → aprovação com as regras do domínio → plano público /ads/plan.
// Armazenamento: Blob EM MEMÓRIA (MOCK) ligado só neste spec, pelo backend de e2e. adServerVendas fica desligada por padrão; ela só é ligada no
// backend de e2e no fim, para provar que o plano continua vazio enquanto o formato não tem capacidade operacional declarada.
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

/** PNG RGB real (cabeçalho, IHDR, IDAT comprimido, IEND, com CRC), de uma cor só. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tipo: string, dados: Buffer) => {
    const t = Buffer.from(tipo, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x22)]);
  const bruto = Buffer.concat(Array.from({ length: height }, () => linha));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(bruto)), chunk('IEND', Buffer.alloc(0))]);
}

const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somarDias = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const blob = async (context: BrowserContext, ligado: boolean) => expect((await context.request.get(`/api/e2e/login?blob=memoria&on=${ligado ? 1 : 0}`)).ok()).toBe(true);
const plano = async (page: Page) => (await (await page.request.get('/api/commercial/ads/plan?positions=SIDEBAR_1')).json()) as { slots: { positionId: string; available: boolean }[] };

test.describe('Criativo real ponta a ponta', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.request.get('/api/e2e/login?blob=memoria&on=0');
    await ctx.request.get('/api/e2e/login?flag=adServerVendas&on=0');
    await ctx.close();
  });

  test('upload medido no servidor, aprovação só com arquivo e alt, plano vazio sem venda e sem capacidade', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await blob(context, true);
    const inicio = hojeSp();
    const fim = somarDias(inicio, 40);

    // anunciante e campanha (posição SIDEBAR_1, 336x280, até 150 KB), período que inclui hoje
    await page.goto('/studio/crm');
    await page.getByLabel('Nome do anunciante').fill('Criativo Real SA');
    await enviar(page, page.getByRole('button', { name: 'Criar anunciante' }));
    await sucesso(page, 'Anunciante criado.');
    await page.goto('/studio/campanhas');
    await page.getByLabel('Nome', { exact: true }).fill('Sidebar Real');
    await page.getByLabel('Anunciante (conta)').selectOption({ label: 'Criativo Real SA' });
    await page.getByLabel('Formato').selectOption('banners--retangulo-sidebar');
    await page.getByLabel('Início (obrigatório)').fill(inicio);
    await page.getByLabel('Fim (obrigatório)').fill(fim);
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await sucesso(page, 'Campanha criada em rascunho.');
    const urlCampanha = page.url().split('?')[0]!;
    await page.getByTestId('posicoes-campanha').getByLabel('SIDEBAR_1').check();
    await enviar(page, page.getByRole('button', { name: 'Salvar posições' }));
    await sucesso(page, 'Posições da campanha atualizadas.');

    // A: com alt e destino; B: sem alt; C: com alt e sem arquivo
    const novo = async (alt: string) => {
      if (alt) await page.getByLabel('Texto alternativo').fill(alt);
      await page.getByLabel('Destino (https').fill('https://criativoreal.example/oferta');
      await enviar(page, page.getByRole('button', { name: 'Adicionar criativo' }));
      await sucesso(page, 'Criativo adicionado');
      return (await page.locator('li[data-criativo]').last().getAttribute('data-criativo'))!;
    };
    const a = await novo('Oferta Criativo Real');
    const b = await novo('');
    const c = await novo('Sem arquivo');

    // arquivo na dimensão errada: recusado antes de gravar, o criativo continua sem arquivo
    await page.getByLabel(`Arquivo de ${a}`).setInputFiles({ name: 'errado.png', mimeType: 'image/png', buffer: png(300, 250) });
    await enviar(page, page.getByRole('button', { name: `Enviar arquivo de ${a}` }));
    await erro(page, /não serve como desktop de SIDEBAR_1: o esperado é 336x280/);
    await expect(page.locator(`li[data-criativo="${a}"]`)).toContainText('Arquivo: nenhum');

    // arquivo certo: tipo, dimensão, peso e hash medidos no servidor
    for (const id of [a, b]) {
      await page.getByLabel(`Arquivo de ${id}`).setInputFiles({ name: `${id}.png`, mimeType: 'image/png', buffer: png(336, 280) });
      await enviar(page, page.getByRole('button', { name: `Enviar arquivo de ${id}` }));
      await sucesso(page, 'Arquivo do criativo enviado');
      await expect(page.locator(`li[data-criativo="${id}"]`)).toContainText(/image\/png, 336x280, .* KB, sha256 [0-9a-f]{12}…/);
    }

    for (const id of [a, b]) await expect(page.locator(`li[data-criativo="${id}"] [data-variante]`)).toHaveText('Desktop 336x280');

    // criativo MOBILE (laterais = 300x250): a mobile do topo (320x100) e a desktop marcada como mobile são recusadas; a certa vira "Mobile 300x250"
    await page.goto(urlCampanha);
    const m = await novo('Oferta Criativo Real no celular');
    await expect(page.locator(`li[data-criativo="${m}"] [data-variante]`)).toHaveText('Sem arquivo');
    const enviarMobile = async (w: number, h: number) => {
      await page.getByLabel(`Dispositivo de ${m}`).selectOption('mobile');
      await page.getByLabel(`Arquivo de ${m}`).setInputFiles({ name: `${m}.png`, mimeType: 'image/png', buffer: png(w, h) });
      await enviar(page, page.getByRole('button', { name: `Enviar arquivo de ${m}` }));
    };
    await enviarMobile(320, 100);
    await erro(page, 'Arquivo 320x100 não serve como mobile de SIDEBAR_1: o esperado é 300x250.');
    await enviarMobile(336, 280);
    await erro(page, /não serve como mobile de SIDEBAR_1/);
    await expect(page.locator(`li[data-criativo="${m}"]`)).toContainText('Arquivo: nenhum');
    await enviarMobile(300, 250);
    await sucesso(page, 'Arquivo do criativo enviado');
    await expect(page.locator(`li[data-criativo="${m}"] [data-variante]`)).toHaveText('Mobile 300x250');
    await expect(page.locator(`li[data-criativo="${m}"]`)).toContainText(/image\/png, 300x250, .* KB, sha256 [0-9a-f]{12}…/);
    // DP-43: o comercial não vê "Aprovar"; quem aprova é o proprietário (admin)
    await expect(page.getByRole('button', { name: `Aprovar ${m}` })).toHaveCount(0);
    await entrar(context, 'dono', 'admin');
    await page.goto(urlCampanha);
    await enviar(page, page.getByRole('button', { name: `Aprovar ${m}` }));
    await sucesso(page, 'Criativo aprovado.');
    await expect(page.locator(`li[data-criativo="${m}"]`)).toHaveAttribute('data-aprovado', 'sim');
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ax.violations.map((v) => v.id)).toEqual([]);

    // sem alt não aprova; sem arquivo (sem hash) não aprova; o completo aprova
    await enviar(page, page.getByRole('button', { name: `Aprovar ${b}` }));
    await erro(page, /incompleto|especificação/);
    await expect(page.locator(`li[data-criativo="${b}"]`)).toHaveAttribute('data-aprovado', 'nao');
    await enviar(page, page.getByRole('button', { name: `Aprovar ${c}` }));
    await erro(page, /incompleto|especificação/);
    await expect(page.locator(`li[data-criativo="${c}"]`)).toHaveAttribute('data-aprovado', 'nao');
    await enviar(page, page.getByRole('button', { name: `Aprovar ${a}` }));
    await sucesso(page, 'Criativo aprovado.');
    await expect(page.locator(`li[data-criativo="${a}"]`)).toHaveAttribute('data-aprovado', 'sim');

    // aprovado não é "no ar": sem venda ligada e campanha ativa, a imagem pública não sai
    expect((await page.request.get(`/api/commercial/ads/creative-image?id=${encodeURIComponent(a)}`)).status()).toBe(404);

    // plano público: venda desligada (padrão) ⇒ posição sem anúncio
    expect((await plano(page)).slots).toEqual([expect.objectContaining({ positionId: 'SIDEBAR_1', available: false })]);

    // reservar (comercial) e aprovar a campanha (proprietário); ativar é recusado sem venda ligada
    await entrar(context, 'caio', 'comercial');
    await page.goto(urlCampanha);
    await enviar(page, page.getByRole('button', { name: 'Reservar posição' }));
    await sucesso(page, 'Posição reservada.');
    await enviar(page, page.getByRole('button', { name: 'Mover para reserved' }));
    await sucesso(page, 'Estado da campanha atualizado.');
    // o comercial não aprova a campanha (sem o botão); o proprietário aprova
    await expect(page.getByRole('button', { name: 'Mover para approved' })).toHaveCount(0);
    await entrar(context, 'dono', 'admin');
    await page.goto(urlCampanha);
    await enviar(page, page.getByRole('button', { name: 'Mover para approved' }));
    await sucesso(page, 'Estado da campanha atualizado.');
    await enviar(page, page.getByRole('button', { name: 'Mover para active' }));
    await expect(page.locator('main .st-alert.err').first()).toBeVisible();

    // mesmo com a venda ligada (só no backend de e2e), o formato está "sob consulta" (sem capacidade operacional declarada):
    // a ativação é recusada e o plano continua vazio — nada entra no ar sem a decisão do proprietário
    await definirFlag(context, 'adServerVendas', true);
    await page.goto(urlCampanha);
    await enviar(page, page.getByRole('button', { name: 'Mover para active' }));
    await erro(page, /formato|dispon/i);
    expect((await plano(page)).slots).toEqual([expect.objectContaining({ positionId: 'SIDEBAR_1', available: false })]);
    await definirFlag(context, 'adServerVendas', false);
    await blob(context, false);
  });
});
