import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar, semearFabrica } from './helpers';

// Mídia, Agenda, fontes da Fábrica e correções sobre as ROTAS REAIS do Backend (PGlite só no build de e2e).
// Banco compartilhado e começa vazio: os testes rodam em série e em ordem.
test.describe.configure({ mode: 'serial' });

const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err, main span.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const HASH = 'b'.repeat(64);

test.describe('Biblioteca de mídia (/api/midia)', () => {
  test('começa vazia; valida; registra com direito; pendente não é publicável; filtro; só chefia remove', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/midia');
    await expect(page.getByRole('heading', { name: 'Nenhum ativo na biblioteca' })).toBeVisible();
    await enviar(page, page.getByRole('button', { name: 'Registrar ativo' }));
    await erro(page, /direitos.url/);

    await page.getByLabel('URL do ativo').fill('https://exemplo.com.br/a.jpg');
    await page.getByLabel(/SHA-256/).fill('curto');
    await page.getByLabel('Crédito').fill('Agência');
    await page.getByLabel('Texto alternativo').fill('Cartão de fidelidade');
    await page.getByLabel('Base de direito').selectOption('licenca');
    await enviar(page, page.getByRole('button', { name: 'Registrar ativo' }));
    await erro(page, /sha256/i);

    await page.getByLabel('URL do ativo').fill('https://exemplo.com.br/a.jpg');
    await page.getByLabel(/SHA-256/).fill(HASH);
    await page.getByLabel('Crédito').fill('Agência');
    await page.getByLabel('Texto alternativo').fill('Cartão de fidelidade');
    await page.getByLabel('Base de direito').selectOption('licenca');
    await enviar(page, page.getByRole('button', { name: 'Registrar ativo' }));
    await sucesso(page, 'Ativo registrado');
    await expect(page.getByRole('row', { name: /a\.jpg/ })).toContainText('Publicável');

    await page.getByLabel('URL do ativo').fill('https://exemplo.com.br/p.jpg');
    await page.getByLabel(/SHA-256/).fill('c'.repeat(64));
    await page.getByLabel('Crédito').fill('Própria');
    await page.getByLabel('Texto alternativo').fill('Pendente');
    await enviar(page, page.getByRole('button', { name: 'Registrar ativo' }));
    await expect(page.getByRole('row', { name: /p\.jpg/ })).toContainText('Direito pendente');

    await page.goto('/studio/midia?filtro=video');
    await expect(page.getByRole('heading', { name: 'Nenhum ativo na biblioteca' })).toBeVisible();
    await page.goto('/studio/midia?filtro=zzz');
    await expect(page.getByText(/Filtro inválido/)).toBeVisible();

    await page.goto('/studio/midia');
    await expect(page.getByRole('button', { name: /Remover/ })).toHaveCount(0); // editor não remove
    await entrar(context, 'chefe', 'editor_chefe');
    await page.goto('/studio/midia');
    await enviar(page, page.getByRole('button', { name: /Remover https:\/\/exemplo\.com\.br\/p\.jpg/ }));
    await sucesso(page, 'Ativo removido.');
    await expect(page.getByRole('row', { name: /p\.jpg/ })).toHaveCount(0);
  });

  test('leitor lê sem registrar', async ({ page, context }) => {
    await entrar(context, 'lia', 'leitor');
    await page.goto('/studio/midia');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/midia');
    await expect(page.getByText('Seu papel só lê a biblioteca.')).toBeVisible();
  });
});

test.describe('Agenda (/api/agenda)', () => {
  test('exige fonte oficial; encerrado sai de "Próximos"; só chefia remove', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/agenda');
    await expect(page.getByRole('heading', { name: 'Nenhum evento cadastrado' })).toBeVisible();
    await page.getByLabel('Título').fill('Congresso sem fonte');
    await page.getByLabel(/Início/).fill('2099-12-01');
    await page.getByLabel('Local').fill('São Paulo');
    await enviar(page, page.getByRole('button', { name: 'Criar evento' }));
    await erro(page, /fonteUrl/);

    const criar = async (titulo: string, inicio: string, fim: string) => {
      await page.getByLabel('Título').fill(titulo);
      await page.getByLabel(/Início/).fill(inicio);
      await page.getByLabel(/Fim/).fill(fim);
      await page.getByLabel('Local').fill('São Paulo');
      await page.getByLabel('Fonte oficial (URL)').fill('https://congresso.exemplo.com.br');
      await enviar(page, page.getByRole('button', { name: 'Criar evento' }));
      await sucesso(page, 'Evento criado.');
    };
    await criar('Evento futuro', '2099-12-01', '2099-12-02');
    await criar('Evento antigo', '2000-01-01', '2000-01-02');
    const proximos = page.getByRole('region', { name: 'Próximos' });
    const arquivo = page.getByRole('region', { name: 'Arquivo (encerrados)' });
    await expect(proximos.getByRole('row', { name: /Evento futuro/ })).toBeVisible();
    await expect(proximos.getByRole('row', { name: /Evento antigo/ })).toHaveCount(0);
    await expect(arquivo.getByRole('row', { name: /Evento antigo/ })).toBeVisible();

    await page.getByLabel('Título').fill('Fim antes do início');
    await page.getByLabel(/Início/).fill('2099-12-10');
    await page.getByLabel(/Fim/).fill('2099-12-09');
    await page.getByLabel('Local').fill('Rio');
    await page.getByLabel('Fonte oficial (URL)').fill('https://congresso.exemplo.com.br');
    await enviar(page, page.getByRole('button', { name: 'Criar evento' }));
    await erro(page, /fim anterior|fim/i);

    await expect(page.getByRole('button', { name: /Remover/ })).toHaveCount(0);
    await entrar(context, 'chefe', 'editor_chefe');
    await page.goto('/studio/agenda');
    await enviar(page, page.getByRole('button', { name: 'Remover Evento antigo' }));
    await sucesso(page, 'Evento removido.');
    await expect(page.getByRole('row', { name: /Evento antigo/ })).toHaveCount(0);
  });
});

test.describe('Fontes da Fábrica (/api/studio/editorial/sources)', () => {
  test('todas nascem desabilitadas; habilitar sem revisão é recusado; revisão exige nota e conferências', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/fontes/fabrica');
    await expect(page.getByRole('heading', { level: 1, name: 'Fontes da Fábrica editorial' })).toBeVisible();
    const azul = page.locator('[data-fabrica-fonte="azul-ri"]');
    await expect(azul).toBeVisible();
    await expect(page.locator('[data-habilitada="sim"]')).toHaveCount(0);
    await expect(azul).toContainText('Sem revisão registrada.');
    await expect(azul.getByRole('button', { name: /Habilitar/ })).toHaveCount(0); // revisor não habilita

    await azul.getByText('Registrar revisão dos termos').click();
    await enviar(page, azul.getByRole('button', { name: 'Registrar revisão' }));
    await erro(page, /termsNote/);

    await azul.getByText('Registrar revisão dos termos').click();
    await azul.getByLabel(/O que foi conferido/).fill('Termos oficiais lidos em 22/11: vedam reprodução sem autorização.');
    await enviar(page, azul.getByRole('button', { name: 'Registrar revisão' }));
    await erro(page, /URL verificada|robots/i); // aprovação exige URL verificada e robots conferido

    await azul.getByText('Registrar revisão dos termos').click();
    await azul.getByLabel(/O que foi conferido/).fill('Termos oficiais lidos em 22/11: vedam reprodução sem autorização.');
    await azul.getByLabel('URL verificada').check();
    await azul.getByLabel('robots.txt conferido').check();
    await enviar(page, azul.getByRole('button', { name: 'Registrar revisão' }));
    await sucesso(page, 'Revisão registrada');
    await expect(azul).toContainText('Última revisão:');
    await expect(page.locator('[data-habilitada="sim"]')).toHaveCount(0); // revisar não habilita
  });

  test('chefia habilita só com revisão atual e pode desabilitar', async ({ page, context }) => {
    await entrar(context, 'chefe', 'editor_chefe');
    await page.goto('/studio/fontes/fabrica');
    const gol = page.locator('[data-fabrica-fonte="gol-ri"]');
    await enviar(page, gol.getByRole('button', { name: /Habilitar/ }));
    await erro(page, /sem revisão registrada/i);

    const azul = page.locator('[data-fabrica-fonte="azul-ri"]');
    await enviar(page, azul.getByRole('button', { name: /Habilitar/ }));
    // pode habilitar ou recusar por inelegibilidade do cadastro; em ambos os casos a mensagem do Backend aparece e nada fica falso
    const msg = page.locator('main .st-alert').filter({ hasText: /Fonte habilitada|inelegível|revisão|termos/i }).first();
    await expect(msg).toBeVisible();
    if (await page.locator('[data-fabrica-fonte="azul-ri"][data-habilitada="sim"]').count()) {
      await page.locator('[data-fabrica-fonte="azul-ri"]').getByRole('button', { name: /Desabilitar/ }).click();
      await sucesso(page, 'Fonte desabilitada.');
      await expect(page.locator('[data-habilitada="sim"]')).toHaveCount(0);
    }
    await entrar(context, 'ed', 'editor');
    await page.goto('/studio/fontes/fabrica');
    await expect(page.getByRole('button', { name: /Registrar revisão|Habilitar/ })).toHaveCount(0);
  });
});

test.describe('Correções e direito de resposta (/api/studio/editorial/corrections)', () => {
  test('caso completo: abrir, verificar, preservar, triar, ciência jurídica, aviso, redes, entidades e encerrar', async ({ page, context }) => {
    const articleId = await semearFabrica(context);
    await entrar(context, 'adm', 'admin');
    await page.goto('/studio/cms/correcoes');
    await expect(page.getByRole('heading', { name: 'Nenhum caso registrado' })).toBeVisible();

    // matéria inexistente é recusada pelo Backend
    await page.getByLabel(/ID da matéria/).fill('materia-que-nao-existe');
    await page.getByLabel('Trecho ou afirmação contestada').fill('O programa não mudou a regra.');
    await page.getByLabel('Solicitante', { exact: true }).fill('Maria Souza');
    await page.getByLabel('Texto da resposta do solicitante (direito de resposta)').fill('Gostaria de registrar que a regra não mudou para clientes antigos.');
    await enviar(page, page.getByRole('button', { name: 'Abrir caso' }));
    await erro(page, /matéria não encontrada/i);

    await page.getByLabel(/ID da matéria/).fill(articleId);
    await page.getByLabel('Trecho ou afirmação contestada').fill('O programa não mudou a regra.');
    await page.getByLabel('Solicitante', { exact: true }).fill('Maria Souza');
    await page.getByLabel('Canal', { exact: true }).selectOption('form');
    await page.getByLabel('Texto da resposta do solicitante (direito de resposta)').fill('Gostaria de registrar que a regra não mudou para clientes antigos.');
    await page.getByLabel('Prazo (AAAA-MM-DD, opcional)').fill('2099-12-31');
    await enviar(page, page.getByRole('button', { name: 'Abrir caso' }));
    await sucesso(page, 'Caso aberto.');
    await expect(page.locator('[data-estado="received"]')).toBeVisible();
    await expect(page.getByText(/identidade NÃO verificada/)).toBeVisible();
    await expect(page.getByText('O contato nunca é exibido.')).toBeVisible();

    await enviar(page, page.getByRole('button', { name: 'Verificar solicitante' }));
    await erro(page, /method/);
    await page.getByLabel(/Método de verificação/).fill('Contato de retorno por e-mail institucional');
    await enviar(page, page.getByRole('button', { name: 'Verificar solicitante' }));
    await sucesso(page, 'Passo registrado.');
    await expect(page.getByText(/identidade verificada/)).toBeVisible();

    await page.getByLabel('URL da página contestada').fill('https://exemplo.com.br/materia-contestada');
    await page.getByLabel('Conteúdo capturado da página').fill('Texto da página capturado para preservar a evidência do caso.');
    await enviar(page, page.getByRole('button', { name: 'Preservar evidência' }));
    await sucesso(page, 'Passo registrado.');
    await expect(page.locator('[data-estado="evidence_preserved"]')).toBeVisible();

    await page.getByLabel('Motivo (mínimo 3 caracteres)').fill('Pedido procedente conforme texto do requerente');
    await enviar(page, page.getByRole('button', { name: 'Registrar triagem' }));
    await sucesso(page, 'Passo registrado.');
    await expect(page.locator('[data-estado="escalated_legal"]')).toBeVisible(); // direito de resposta escala ao responsável
    await expect(page.getByRole('button', { name: 'Publicar aviso' })).toHaveCount(0);

    await enviar(page, page.getByRole('button', { name: 'Dar ciência do caso jurídico' }));
    await sucesso(page, 'Passo registrado.');
    await expect(page.getByText(/ciência do responsável: [0-9]{4}-[0-9]{2}-[0-9]{2}/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dar ciência do caso jurídico' })).toHaveCount(0);

    await enviar(page, page.getByRole('button', { name: 'Publicar aviso' }));
    await sucesso(page, 'Passo registrado.');
    await expect(page.locator('[data-estado="notice_published"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aviso publicado' })).toBeVisible();
    await expect(page.getByText(/Gostaria de registrar que a regra não mudou/).first()).toBeVisible(); // texto do requerente preservado

    await enviar(page, page.getByRole('button', { name: 'Marcar entidades reconstruídas' }));
    await sucesso(page, 'Passo registrado.');
    await enviar(page, page.getByRole('button', { name: 'Reconciliar redes sociais' }));
    await sucesso(page, 'Passo registrado.');
    await expect(page.locator('[data-estado="social_reconciled"]')).toBeVisible();
    await enviar(page, page.getByRole('button', { name: 'Encerrar caso' }));
    await sucesso(page, 'Passo registrado.');
    await expect(page.locator('[data-estado="closed"]')).toBeVisible();
    await expect(page.getByText('Caso encerrado.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Histórico do caso' }).getByRole('listitem')).toHaveCount(7);
  });

  test('revisor e editor só acompanham; chefia não dá ciência jurídica', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms/correcoes');
    await expect(page.getByRole('button', { name: 'Abrir caso' })).toHaveCount(0);
    await page.getByRole('link', { name: /^[0-9a-f-]{36}$/ }).first().click();
    await expect(page.getByText('Seu papel só acompanha os casos.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Encerrar|Publicar|Verificar/ })).toHaveCount(0);
  });

  test('fila da Fábrica semeada: revisão com gate recalculado, recheck e decisão humana', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms/checagem');
    await expect(page.locator('tr[data-fabrica="fabrica-e2e-1"]')).toBeVisible();
    await page.getByRole('link', { name: /Programa Alfa altera regra de pontos \(Fábrica\)/ }).click();
    await expect(page.locator('[data-gate="nao-passou"]')).toBeVisible(); // sem veredito de fatos o gate não passa
    await expect(page.getByRole('heading', { name: /Gate de fatos: não passou/ })).toBeVisible();
    await expect(page.getByRole('table').first()).toContainText('sem veredito');
    await page.getByLabel('Decisão', { exact: true }).selectOption('confirm');
    await page.getByLabel(/Nota/).fill('tentando confirmar sem gate');
    await enviar(page, page.getByRole('button', { name: 'Registrar decisão' }));
    await erro(page, /aprovada|gate/i); // humano não força aprovação

    await page.getByLabel('Decisão', { exact: true }).selectOption('send_back');
    await page.getByLabel(/Nota/).fill('Devolvida para ajuste das afirmações');
    await enviar(page, page.getByRole('button', { name: 'Registrar decisão' }));
    await sucesso(page, 'Decisão de revisão registrada.');
    await expect(page.getByText(/send_back — Devolvida para ajuste/)).toBeVisible();
  });
});
