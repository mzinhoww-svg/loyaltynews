import { expect, test, type Page } from '@playwright/test';
import { definirFlag, entrar, enviar } from './helpers';

// CMS editorial, Fontes e Social sobre as ROTAS REAIS do Backend (PostgreSQL de e2e = PGlite, só no build de e2e).
// O banco é compartilhado e começa vazio; os testes rodam em série e em ordem.
test.describe.configure({ mode: 'serial' });

const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err, main span.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

const TITULO = 'Programa Alfa muda regra de pontos';
const TITULO2 = 'Banco Beta revisa tarifas de cartão';

async function criarMateria(page: Page, titulo: string, opts: { evidencia?: boolean } = {}) {
  await page.goto('/studio/cms/nova');
  await page.getByLabel('Título', { exact: true }).fill(titulo);
  await page.getByLabel(/Resumo/).fill('Resumo curto da matéria de teste.');
  await page.getByLabel('Editoria', { exact: true }).selectOption('pontos');
  await page.getByLabel('Corpo da matéria').fill('Texto completo da matéria de teste.');
  if (opts.evidencia !== false) await page.getByLabel(/Comunicado Programa X:/).check();
  await enviar(page, page.getByRole('button', { name: 'Criar rascunho' }));
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
}

test.describe('Fontes e evidências (/api/fontes)', () => {
  test('começa vazio; revisor só lê', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/fontes');
    await expect(page.getByRole('heading', { name: 'Nenhuma fonte cadastrada' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cadastrar fonte' })).toHaveCount(0);
    await expect(page.getByText('Seu papel só lê o banco de fontes.')).toBeVisible();
  });

  test('valida, cadastra inativa, exige termos para ativar e registra evidência com hash calculado', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/fontes');
    await enviar(page, page.getByRole('button', { name: 'Cadastrar fonte' }));
    await erro(page, /Entrada inválida|nome|url/i);

    await page.getByLabel('Nome', { exact: true }).fill('Comunicado Programa X');
    await page.getByLabel('URL pública').fill('https://exemplo.com.br/imprensa');
    await page.getByLabel('Pontos & Milhas').check();
    await enviar(page, page.getByRole('button', { name: 'Cadastrar fonte' }));
    await sucesso(page, 'Fonte cadastrada');
    const linha = page.locator('tr[data-fonte]').filter({ hasText: 'Comunicado Programa X' });
    await expect(linha).toContainText('Inativa');
    await expect(linha).toContainText('Pendentes');

    await enviar(page, page.getByRole('button', { name: 'Ativar: Comunicado Programa X' }));
    await erro(page, /termos/i);
    await enviar(page, page.getByRole('button', { name: 'Marcar termos revisados: Comunicado Programa X' }));
    await enviar(page, page.getByRole('button', { name: 'Ativar: Comunicado Programa X' }));
    await expect(page.locator('tr[data-fonte]').filter({ hasText: 'Comunicado Programa X' })).toContainText('Ativa');

    await page.getByRole('link', { name: 'Comunicado Programa X' }).click();
    await expect(page.locator('[data-vazio="evidencias"]')).toBeVisible();
    await page.getByLabel('URL da página').fill('https://exemplo.com.br/imprensa/regra-nova');
    await page.getByLabel('Texto capturado').fill('Texto oficial capturado da página de imprensa.');
    await enviar(page, page.getByRole('button', { name: 'Registrar evidência' }));
    await sucesso(page, 'Evidência registrada.');
    await expect(page.getByRole('row', { name: /regra-nova/ })).toContainText('…');
  });
});

test.describe('CMS editorial (/api/materias)', () => {
  test('fila começa vazia, sem matéria fictícia; checagem e correções vazias', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms');
    await expect(page.getByRole('heading', { name: 'Nenhuma matéria ainda' })).toBeVisible();
    await page.goto('/studio/cms/checagem');
    await expect(page.locator('[data-vazio="cms-checagem"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nenhuma matéria da Fábrica na fila' })).toBeVisible();
    await page.goto('/studio/cms/correcoes');
    await expect(page.getByRole('heading', { name: 'Nenhum caso registrado' })).toBeVisible();
    expect((await page.goto('/studio/cms/checagem/artigo-inexistente'))?.status()).toBe(404);
    expect((await page.goto('/studio/cms/correcoes/caso-inexistente'))?.status()).toBe(404);
    expect((await page.goto('/studio/cms/nao-e-uuid'))?.status()).toBe(404);
  });

  test('a API valida o formulário e o editor mostra o erro por campo', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms/nova');
    await enviar(page, page.getByRole('button', { name: 'Criar rascunho' }));
    // faixa curta + erro por campo em português, sem texto cru do validador nem o slug (que não é campo da tela)
    await expect(page.getByRole('alert').filter({ hasText: 'Corrija os campos destacados' }).first()).toBeVisible();
    const erroTitulo = page.locator('.st-field', { has: page.locator('#titulo') }).locator('span.err');
    await expect(erroTitulo).toContainText('obrigatório');
    await expect(page.locator('main')).not.toContainText(/Too small|Invalid|Slug:/);
    // P2-06: o erro de um campo some assim que a pessoa o edita (sem esperar reenviar); os dos outros ficam
    await page.getByLabel('Título', { exact: true }).fill('Um título qualquer');
    await expect(erroTitulo).toHaveCount(0);
    await expect(page.locator('.st-field span.err').first()).toBeVisible();
  });

  test('criar, editar (nova versão), enviar sem fonte falha, enviar para checagem', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await criarMateria(page, TITULO);
    await expect(page.getByText('Rascunho criado (v1).')).toBeVisible();
    await expect(page.getByText('assinatura Redação Loyalty News')).toBeVisible();
    await expect(page.locator('.ln-pill', { hasText: 'Rascunho' }).first()).toBeVisible();

    await page.getByLabel('Corpo da matéria').fill('Texto revisado pela redação, versão dois.');
    await enviar(page, page.getByRole('button', { name: 'Salvar como nova versão' }));
    await expect(page.getByText('Nova versão v2 salva.')).toBeVisible();

    await enviar(page, page.getByRole('button', { name: 'Enviar para checagem' }));
    await sucesso(page, 'Enviada para checagem.');
    await expect(page.locator('.ln-pill', { hasText: 'Em checagem' }).first()).toBeVisible();
    await expect(page.getByText('Só rascunho e bloqueado são editáveis')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar como nova versão' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();

    // matéria sem fontes não vai à checagem (regra do Backend)
    await criarMateria(page, 'Matéria sem fonte para teste', { evidencia: false });
    await enviar(page, page.getByRole('button', { name: 'Enviar para checagem' }));
    await erro(page, /sem fontes/i);
  });

  test('revisor: recibo exige checagens, aprova a versão e o histórico registra as transições', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms?status=em_checagem');
    await page.getByRole('link', { name: TITULO }).click();
    await enviar(page, page.getByRole('button', { name: 'Emitir recibo da versão' }));
    await erro(page, 'Marque ao menos uma checagem aprovada.');
    await page.getByLabel('editor', { exact: true }).check();
    await page.getByLabel('direitos', { exact: true }).check();
    await enviar(page, page.getByRole('button', { name: 'Emitir recibo da versão' }));
    await sucesso(page, 'Recibo da versão emitido.');
    await expect(page.getByText(/Recibo da v2: .*(direitos|editor).*(direitos|editor)/)).toBeVisible();
    await enviar(page, page.getByRole('button', { name: 'Aprovar v2' }));
    await sucesso(page, 'Matéria aprovada.');
    await expect(page.locator('.ln-pill', { hasText: 'Aprovado' }).first()).toBeVisible();
    const hist = page.locator('aside').getByText(/em_checagem → aprovado/);
    await expect(hist).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar como nova versão' })).toHaveCount(0); // revisor não edita
  });

  test('aprovada volta a rascunho para editar; bloqueio exige motivo', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms?status=aprovado');
    await page.getByRole('link', { name: TITULO }).click();
    await enviar(page, page.getByRole('button', { name: 'Voltar a rascunho' }));
    await sucesso(page, 'Matéria voltou a rascunho.');
    await page.getByLabel('Corpo da matéria').fill('Texto da versão três após a aprovação.');
    await enviar(page, page.getByRole('button', { name: 'Salvar como nova versão' }));
    await expect(page.getByText('Nova versão v3 salva.')).toBeVisible();

    await criarMateria(page, TITULO2);
    await enviar(page, page.getByRole('button', { name: 'Enviar para checagem' }));
    await sucesso(page, 'Enviada para checagem.');
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms?status=em_checagem');
    await page.getByRole('link', { name: TITULO2 }).click();
    await enviar(page, page.getByRole('button', { name: 'Bloquear' }));
    await erro(page, /nota|motivo/i);
    await page.getByLabel('Motivo do bloqueio').fill('Fonte não confirma o número');
    await enviar(page, page.getByRole('button', { name: 'Bloquear' }));
    await sucesso(page, 'Matéria bloqueada.');
    await expect(page.locator('.ln-pill', { hasText: 'Bloqueado' }).first()).toBeVisible();
    await expect(page.getByText(/Fonte não confirma o número/)).toBeVisible();
  });

  test('atalhos "para mim": o papel vê o que espera por ele (revisão e publicação)', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/cms');
    await expect(page.locator('[data-para-mim-revisar]')).toBeVisible();
    await expect(page.locator('[data-para-mim-publicar]')).toBeVisible();
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms');
    await expect(page.locator('[data-para-mim-revisar]')).toBeVisible();
    await expect(page.locator('[data-para-mim-publicar]')).toHaveCount(0);
    await page.locator('[data-para-mim-revisar]').click();
    await expect(page).toHaveURL(/status=em_checagem/);
    await entrar(context, 'ed', 'editor');
    await page.goto('/studio/cms');
    await expect(page.locator('[data-para-mim]')).toHaveCount(0);
  });

  test('filtros por estado, editoria e busca; filtro inválido é recusado pela API', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms?status=bloqueado');
    await expect(page.getByRole('link', { name: TITULO2 })).toBeVisible();
    await expect(page.getByRole('link', { name: TITULO })).toHaveCount(0);
    await page.goto('/studio/cms?editoria=mercado');
    await expect(page.getByRole('heading', { name: 'Nenhuma matéria com esses filtros' })).toBeVisible();
    await page.goto('/studio/cms');
    await page.getByLabel('Buscar no título').fill('alfa');
    await enviar(page, page.getByRole('button', { name: 'Filtrar' }));
    await expect(page.getByRole('link', { name: TITULO })).toBeVisible();
    await expect(page.getByRole('link', { name: TITULO2 })).toHaveCount(0);
    await page.goto('/studio/cms?status=inexistente');
    await expect(page.getByText('Filtro inválido')).toBeVisible();
  });

  test('papéis: leitor lê sem criar; comercial não acessa', async ({ page, context }) => {
    await entrar(context, 'lia', 'leitor');
    await page.goto('/studio/cms');
    await expect(page.getByRole('link', { name: 'Nova matéria' })).toHaveCount(0);
    await page.goto('/studio/cms/nova');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/cms');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});

test.describe('Social dashboard gerando pacote de matéria real (/api/studio/social)', () => {
  test('matéria sem fatos aprovados vira pacote "falhou"; o Studio não publica', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/cms');
    await page.getByRole('link', { name: TITULO2 }).click();
    // aprova a matéria 2 para torná-la elegível: volta a rascunho, envia, recibo e aprovação
    await enviar(page, page.getByRole('button', { name: 'Voltar a rascunho' }));
    await sucesso(page, 'voltou a rascunho');
    await enviar(page, page.getByRole('button', { name: 'Enviar para checagem' }));
    await sucesso(page, 'Enviada para checagem.');
    await page.getByLabel('editor', { exact: true }).check();
    await enviar(page, page.getByRole('button', { name: 'Emitir recibo da versão' }));
    await sucesso(page, 'Recibo da versão emitido.');
    await enviar(page, page.getByRole('button', { name: /^Aprovar v/ }));
    await sucesso(page, 'Matéria aprovada.');

    await page.goto('/studio/social');
    await expect(page.getByText('Nenhum pacote social gerado ainda.')).toBeVisible();
    await page.getByLabel('Matéria aprovada').selectOption({ label: TITULO2 });
    await enviar(page, page.getByRole('button', { name: 'Gerar pacote' }));
    await sucesso(page, 'Pacote gerado');
    const linha = page.locator('tr[data-package]').first();
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('Falha na geração');
    await expect(page.getByRole('region', { name: 'Resumo do Social Dashboard' }).locator('[data-channel="linkedin"]')).toContainText('1 pacote(s)');
    await linha.getByRole('link').click();
    await expect(page.getByRole('button', { name: 'Pedir publicação simulada' })).toHaveCount(0); // só pacote "gerado" pode ser pedido
    await expect(page.getByRole('button', { name: /publicar/i }).filter({ hasNotText: 'simulada' })).toHaveCount(0);
  });
});

test.describe('Publicação pela rota oficial (/api/studio/editorial/articles/:id/publication)', () => {
  test('desligada por flag: botão desabilitado com a razão; chefia vê o formulário, outros papéis não', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/cms?status=aprovado');
    await page.getByRole('link', { name: TITULO2 }).click();
    await expect(page.getByRole('heading', { name: 'Publicação' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    await expect(page.getByText('Publicação desligada nesta fase.')).toBeVisible();
    await expect(page.getByLabel('URL pública da matéria')).toBeVisible();
    // P2-01: matéria aprovada não é editável e a tela diz isso com clareza (campo travado parece travado)
    await expect(page.locator('[data-travada="sim"]')).toContainText('ficam travados');
    const fundo = await page.locator('#titulo').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fundo).not.toBe('rgb(255, 255, 255)');
    // P2-02: quem aprovou aparece como "você" ou "outro usuário", não só um identificador
    await expect(page.locator('[data-aprovador]')).toContainText(/Aprovado por (você|outro usuário \([0-9a-f]{8}…\))/);
    // a transição genérica não publica nem corrige: a tela não oferece "corrigido"
    await expect(page.getByRole('button', { name: /corrigido|Corrigir/i })).toHaveCount(0);

    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms?status=aprovado');
    await page.getByRole('link', { name: TITULO2 }).click();
    await expect(page.getByLabel('URL pública da matéria')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
  });

  test('ligada: botão habilitado e a URL pública do Portal é só leitura', async ({ page, context }) => {
    await definirFlag(context, 'publicacaoPortal', true);
    try {
      await entrar(context, 'ana', 'editor_chefe');
      await page.goto('/studio/cms?status=aprovado');
      await page.getByRole('link', { name: TITULO2 }).click();
      await expect(page.getByRole('button', { name: 'Publicar' })).toBeEnabled();
      await expect(page.getByText('Publicação desligada nesta fase')).toHaveCount(0);

      // P2-03: a URL pública é a do Portal e não se digita (um erro de digitação gravaria no recibo um link que dá 404)
      await expect(page.getByLabel('URL pública da matéria')).toHaveAttribute('readonly', '');
      await expect(page.getByLabel('URL pública da matéria')).toHaveValue(/\/noticia\//);

      // a publicação que dá certo (matéria só do CMS, rota oficial) é testada em studio-z-correcao-cms.spec.ts, que roda por último
      await expect(page.locator('[data-publicado]')).toHaveCount(0);
    } finally {
      await definirFlag(context, 'publicacaoPortal', false);
    }
  });
});
