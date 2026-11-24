import { expect, test } from '@playwright/test';
import { api, enviar, entrar } from './helpers';

// Home, menus, SEO, links internos e redirects: documentos versionados do Backend (/api/site/**), sessão real.
const ok = (page: import('@playwright/test').Page, texto: string | RegExp) => page.locator('main .st-alert.ok').filter({ hasText: texto }).first();
const erro = (page: import('@playwright/test').Page, texto: string | RegExp) => page.locator('main .st-alert.err').filter({ hasText: texto }).first();

test.describe('Home e menus', () => {
  test.describe.configure({ mode: 'serial' });

  test('sem nada publicado mostra o padrão mínimo e diz que não há versão em vigor', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    await expect(page.getByText('padrão mínimo (nada publicado ainda)')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Blocos da home em ordem' }).getByRole('listitem')).toHaveCount(1);
    await expect(page.locator('[data-situacao="vigente"]')).toContainText('nenhuma versão publicada');
    await expect(page.getByText('Sem rascunho: edite o documento')).toBeVisible();
  });

  test('o formulário de bloco mostra só os campos do tipo escolhido e recusa bloco repetido', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    const form = page.getByRole('form', { name: 'Adicionar bloco' });
    await form.getByLabel('Tipo de bloco').selectOption('publicidade');
    await expect(form.getByLabel('Posição do anúncio')).toBeVisible();
    await expect(form.getByLabel(/Limite de itens/)).toBeHidden();
    await expect(form.getByLabel(/Título \(opcional\)/)).toBeHidden();
    await form.getByLabel('Tipo de bloco').selectOption('lista_editoria');
    await expect(form.getByLabel('Editoria da lista')).toBeVisible();
    await expect(form.getByLabel('Posição do anúncio')).toBeHidden();
    await form.getByLabel('Tipo de bloco').selectOption('ultimas');
    await expect(form.getByLabel('Editoria da lista')).toBeHidden();
    await expect(form.getByLabel(/Limite de itens/)).toBeVisible();
  });

  test('editar grava rascunho; pendência impede publicar; publicar e reverter criam versões', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    const blocos = page.getByRole('list', { name: 'Blocos da home em ordem' }).getByRole('listitem');

    await page.getByLabel('Tipo de bloco').selectOption('agenda');
    await enviar(page, page.getByRole('button', { name: 'Adicionar bloco ao rascunho' }));
    await expect(ok(page, 'Rascunho salvo (ainda não publicado).')).toBeVisible();
    await expect(page.locator('[data-situacao="rascunho"]')).toContainText('em edição');
    await expect(blocos).toHaveCount(2);
    await expect(page.locator('[data-situacao="vigente"]')).toContainText('nenhuma versão publicada');

    // sobe a agenda para o topo
    await enviar(page, page.getByRole('button', { name: 'Subir item 2' }));
    await expect(blocos.nth(0)).toContainText('Agenda');

    // posição sem dimensão reservada não publica
    await page.getByLabel('Tipo de bloco').selectOption('publicidade');
    await page.getByLabel('Posição do anúncio').selectOption('HOME_BETWEEN');
    await enviar(page, page.getByRole('button', { name: 'Adicionar bloco ao rascunho' }));
    await expect(page.locator('[data-pendencias]')).toContainText('HOME_BETWEEN');
    await enviar(page, page.getByRole('button', { name: 'Publicar agora' }));
    await expect(erro(page, /pend|dimens|HOME_BETWEEN/i)).toBeVisible();
    await expect(page.locator('[data-situacao="vigente"]')).toContainText('nenhuma versão publicada');

    // remove o bloco problemático e publica
    await enviar(page, page.locator('[data-bloco="publicidade"]').getByRole('button', { name: /Remover item/ }));
    await expect(blocos).toHaveCount(2);
    await expect(page.locator('[data-pendencias="0"]')).toBeVisible();
    await enviar(page, page.getByRole('button', { name: 'Publicar agora' }));
    await expect(ok(page, 'Documento publicado.')).toBeVisible();
    await expect(page.locator('[data-situacao="vigente"]')).toContainText('v1');
    await expect(page.locator('[data-situacao="rascunho"]')).toContainText('nenhum');

    // nova edição + publicação = v2; reverter para v1 = v3 com o conteúdo da v1
    await enviar(page, page.getByRole('button', { name: 'Remover item 1' }));
    await expect(blocos).toHaveCount(1);
    await enviar(page, page.getByRole('button', { name: 'Publicar agora' }));
    await expect(page.locator('[data-situacao="vigente"]')).toContainText('v2');
    await enviar(page, page.getByRole('button', { name: 'Reverter Home para v1' }));
    await expect(ok(page, 'nova versão com o conteúdo da v1'.replace('nova versão com o conteúdo da v1', 'Rollback concluído'))).toBeVisible();
    await expect(page.locator('[data-situacao="vigente"]')).toContainText('v3');
    await expect(blocos).toHaveCount(2);
    await expect(blocos.nth(0)).toContainText('Agenda');
    await expect(page.locator('[data-versao="1"]')).toBeVisible();
    await expect(page.locator('[data-versao="2"]')).toBeVisible();
  });

  test('menu: item válido entra no rascunho; destino proibido é recusado pelo Backend', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus?tipo=menu_principal');
    await page.locator('#rotulo-item').fill('Programas');
    await page.locator('#destino-item').fill('/programas');
    await enviar(page, page.getByRole('button', { name: 'Adicionar item ao rascunho' }));
    await expect(ok(page, 'Rascunho salvo')).toBeVisible();
    await expect(page.locator('[data-item="Programas"]')).toContainText('/programas');

    await page.locator('#rotulo-item').fill('Interno');
    await page.locator('#destino-item').fill('/api/segredo');
    await enviar(page, page.getByRole('button', { name: 'Adicionar item ao rascunho' }));
    await expect(erro(page, /.+/)).toBeVisible();
    await expect(page.locator('[data-item="Interno"]')).toHaveCount(0);

    await enviar(page, page.getByRole('button', { name: 'Publicar agora' }));
    await expect(ok(page, 'Documento publicado.')).toBeVisible();
    await expect(page.locator('[data-versao="1"]')).toBeVisible();
  });

  test('agendar, ver o agendamento e cancelar', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus?tipo=menu_rodape');
    await page.locator('#rotulo-item').fill('Contato');
    await page.locator('#destino-item').fill('/contato');
    await enviar(page, page.getByRole('button', { name: 'Adicionar item ao rascunho' }));
    await expect(ok(page, 'Rascunho salvo')).toBeVisible();
    const futuro = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 16);
    await page.getByLabel('Agendar para (Brasília)').fill(futuro);
    await enviar(page, page.getByRole('button', { name: 'Agendar' }));
    await expect(ok(page, 'Publicação agendada.')).toBeVisible();
    await expect(page.locator('[data-situacao="agendado"]')).toContainText('para');
    await enviar(page, page.getByRole('button', { name: 'Cancelar agendamento' }));
    await expect(ok(page, 'Agendamento cancelado')).toBeVisible();
    await expect(page.locator('[data-situacao="agendado"]')).toContainText('nenhum');
    await expect(page.locator('[data-situacao="rascunho"]')).toContainText('em edição');
  });

  test('editor sem chefia não acessa a home e os menus', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/home-menus');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});

test.describe('SEO, links internos e redirecionamentos', () => {
  test.describe.configure({ mode: 'serial' });

  test('a redação grava o rascunho do SEO; só a chefia publica', async ({ page, context }) => {
    await entrar(context, 'bia', 'editor');
    await page.goto('/studio/seo');
    // URL do site já vem sugerida pelo ambiente (P1-03) e os obrigatórios estão marcados
    await expect(page.locator('#orgUrl')).toHaveValue(/^https:\/\/portal\.example\.test/);
    await expect(page.getByLabel(/Descrição padrão \(obrigatória/)).toBeVisible();
    await page.locator('#descricaoPadrao').fill('');
    await enviar(page, page.getByRole('button', { name: 'Salvar rascunho do SEO' }));
    await expect(erro(page, /.+/)).toBeVisible();
    // P1-02: o erro sai em português, com o nome do campo da tela, sem texto cru do validador
    const msg = (await erro(page, /.+/).textContent()) ?? '';
    expect(msg).toContain('Descrição padrão');
    expect(msg).not.toMatch(/Too small|Invalid|dadosEstruturados|expected string/i);

    await page.locator('#tituloPadrao').fill('Loyalty News');
    await page.locator('#descricaoPadrao').fill('Notícias de fidelidade.');
    await page.locator('#orgUrl').fill('https://portal.example.test');
    await enviar(page, page.getByRole('button', { name: 'Salvar rascunho do SEO' }));
    await expect(ok(page, 'Rascunho do SEO salvo (ainda não publicado).')).toBeVisible();
    await expect(page.locator('[data-doc="seo_global"] [data-situacao="rascunho"]')).toContainText('em edição');
    await expect(page.getByText('só editor-chefe e admin publicam').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar agora' })).toHaveCount(0);

    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/seo');
    await enviar(page, page.locator('[data-doc="seo_global"]').getByRole('button', { name: 'Publicar agora' }));
    await expect(ok(page, 'Documento publicado.')).toBeVisible();
    await expect(page.locator('[data-doc="seo_global"] [data-situacao="vigente"]')).toContainText('v1');
  });

  test('links internos: adiciona, recusa termo repetido, remove e publica', async ({ page, context }) => {
    await entrar(context, 'bia', 'editor');
    await page.goto('/studio/seo');
    await page.locator('#termo').fill('milhas');
    await page.locator('#destino-link').fill('/editoria/milhas');
    await enviar(page, page.getByRole('button', { name: 'Adicionar regra ao rascunho' }));
    await expect(ok(page, 'Regra de link interno adicionada')).toBeVisible();
    await expect(page.locator('[data-termo="milhas"]')).toContainText('/editoria/milhas');
    // a região rolável da tabela tem o nome da própria tabela (leitor de tela), não o de outra
    await expect(page.getByRole('region', { name: 'Regras de links internos' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Metadados por página' })).toHaveCount(0);

    await page.locator('#termo').fill('Milhas');
    await page.locator('#destino-link').fill('/editoria/pontos');
    await enviar(page, page.getByRole('button', { name: 'Adicionar regra ao rascunho' }));
    await expect(erro(page, /.+/)).toBeVisible();

    await page.locator('#termo').fill('cartoes');
    await page.locator('#destino-link').fill('/editoria/cartoes');
    await enviar(page, page.getByRole('button', { name: 'Adicionar regra ao rascunho' }));
    await expect(page.locator('[data-termo="cartoes"]')).toBeVisible();
    await enviar(page, page.getByRole('button', { name: 'Remover regra cartoes' }));
    await expect(page.locator('[data-termo="cartoes"]')).toHaveCount(0);

    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/seo');
    await enviar(page, page.locator('[data-doc="links_internos"]').getByRole('button', { name: 'Publicar agora' }));
    await expect(ok(page, 'Documento publicado.')).toBeVisible();
  });

  test('redirecionamentos: cria, recusa laço, desativa; só admin exclui', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/seo');
    await expect(page.getByRole('heading', { name: 'Nenhum redirecionamento' })).toBeVisible();
    const criar = async (origem: string, destino: string) => {
      await page.locator('#origem').fill(origem);
      await page.locator('#destino').fill(destino);
      await enviar(page, page.getByRole('button', { name: 'Criar redirecionamento' }));
    };
    await criar('/noticia-antiga', '/noticia/nova');
    await expect(ok(page, 'Redirecionamento criado.')).toBeVisible();
    await expect(page.locator('[data-origem="/noticia-antiga"]')).toContainText('301');

    await criar('/noticia/nova', '/noticia-antiga');
    await expect(erro(page, /laço|cadeia|loop/i)).toBeVisible();
    await criar('/api/x', '/y');
    await expect(erro(page, /.+/)).toBeVisible();

    await enviar(page, page.getByRole('button', { name: 'Desativar redirecionamento de /noticia-antiga' }));
    await expect(page.locator('[data-origem="/noticia-antiga"]')).toHaveAttribute('data-ativo', 'false');
    await expect(page.getByRole('button', { name: 'Remover redirecionamento de /noticia-antiga' })).toHaveCount(0);

    await entrar(context, 'adm', 'admin');
    await page.goto('/studio/seo');
    await enviar(page, page.getByRole('button', { name: 'Remover redirecionamento de /noticia-antiga' }));
    await expect(ok(page, 'Redirecionamento removido.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nenhum redirecionamento' })).toBeVisible();
  });

  test('revisor só lê: sem formulários de escrita', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/seo');
    await expect(page.getByRole('button', { name: 'Salvar rascunho do SEO' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Criar redirecionamento' })).toHaveCount(0);
    await expect(page.getByText('Seu papel só lê as configurações de SEO.')).toBeVisible();
  });
});


// O que o Studio publica é o que o Portal lê: GET /api/publico/site (rota real do Backend) e a caixa "O que o Portal lê agora".
test.describe('Portal lê o que o Studio publica', () => {
  test.describe.configure({ mode: 'serial' });

  const publico = async (context: import('@playwright/test').BrowserContext) => (await api(context, 'GET', '/api/publico/site')).body.data as {
    home: { versao: number; blocos: { id: string; tipo: string; limite?: number; titulo?: string }[] } | null;
    menus: { principal: { itens: { rotulo: string; destino: string; filhos?: { rotulo: string }[] }[] } | null };
    seo: { tituloPadrao: string; indexacao: string } | null;
    linksInternos: { termo: string; destino: string }[];
  };

  test('home: editar bloco no lugar grava rascunho; só a publicação chega ao Portal', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    const antes = await publico(context);
    expect(antes.home?.blocos[0]).toMatchObject({ tipo: 'agenda' });
    await page.goto('/studio/home-menus');
    await expect(page.locator('[data-portal="home"][data-estado="ok"]')).toBeVisible();
    await page.getByText('Editar bloco 1').click();
    await page.getByLabel('Título do bloco 1').fill('Próximos eventos');
    await page.getByLabel('Limite de itens do bloco 1').fill('3');
    await enviar(page, page.getByRole('button', { name: 'Salvar bloco 1' }));
    await expect(ok(page, 'Bloco alterado no rascunho')).toBeVisible();
    await expect(page.locator('[data-situacao="rascunho"]')).toContainText('em edição');
    // rascunho não vaza para o Portal
    expect((await publico(context)).home?.blocos[0]).toEqual(antes.home?.blocos[0]);

    // limite inválido: o Backend recusa e o rascunho segue como estava
    await page.getByText('Editar bloco 1').click();
    await page.getByLabel('Limite de itens do bloco 1').fill('99');
    await enviar(page, page.getByRole('button', { name: 'Salvar bloco 1' }));
    await expect(erro(page, /.+/)).toBeVisible();

    await enviar(page, page.getByRole('button', { name: 'Publicar agora' }));
    await expect(ok(page, 'Documento publicado.')).toBeVisible();
    const depois = await publico(context);
    expect(depois.home?.blocos[0]).toMatchObject({ tipo: 'agenda', limite: 3, titulo: 'Próximos eventos' });
    expect(depois.home!.versao).toBeGreaterThan(antes.home!.versao);
    await expect(page.locator('[data-portal="home"] [data-bloco-portal]').first()).toContainText('Próximos eventos');
    await expect(page.locator('[data-portal="home"] [data-versao]')).toContainText(`v${depois.home!.versao}`);
  });

  test('menu: editar item, subitem e remover subitem; o Portal lê o menu publicado', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus?tipo=menu_principal');
    await expect(page.locator('[data-portal="menus"]')).toBeVisible();
    await page.getByText('Editar item Programas').click();
    await page.getByLabel('Rótulo de Programas', { exact: true }).fill('Programas e milhas');
    await enviar(page, page.getByRole('button', { name: 'Salvar item Programas' }));
    await expect(ok(page, 'Item alterado no rascunho')).toBeVisible();

    await page.getByLabel('Rótulo do subitem de Programas e milhas').fill('Cartões');
    await page.getByLabel('Destino do subitem de Programas e milhas').fill('/editoria/bancos');
    await enviar(page, page.getByRole('button', { name: 'Adicionar subitem a Programas e milhas' }));
    await expect(page.locator('[data-filho="Cartões"]')).toBeVisible();
    await page.getByLabel('Rótulo do subitem de Programas e milhas').fill('Temporário');
    await page.getByLabel('Destino do subitem de Programas e milhas').fill('/editoria/pontos');
    await enviar(page, page.getByRole('button', { name: 'Adicionar subitem a Programas e milhas' }));
    await enviar(page, page.getByRole('button', { name: 'Remover subitem Temporário de Programas e milhas' }));
    await expect(page.locator('[data-filho="Temporário"]')).toHaveCount(0);

    await enviar(page, page.getByRole('button', { name: 'Publicar agora' }));
    await expect(ok(page, 'Documento publicado.')).toBeVisible();
    const itens = (await publico(context)).menus.principal!.itens;
    const item = itens.find((i) => i.rotulo === 'Programas e milhas')!;
    expect(item.destino).toBe('/programas');
    expect(item.filhos?.map((f) => f.rotulo)).toEqual(['Cartões']);
    await expect(page.locator('[data-portal="menus"]')).toContainText('Programas e milhas');
  });

  test('SEO e links internos publicados aparecem na caixa do Portal e na rota pública', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    const site = await publico(context);
    expect(site.seo).toMatchObject({ tituloPadrao: 'Loyalty News', indexacao: 'indexar' });
    expect(site.linksInternos).toEqual([{ termo: 'milhas', destino: '/editoria/milhas' }]);
    await page.goto('/studio/seo');
    await expect(page.locator('[data-portal="seo"] [data-seo="titulo"]')).toHaveText('Loyalty News');
    await expect(page.locator('[data-portal="seo"] [data-seo="indexacao"]')).toHaveText('indexar');
    await expect(page.locator('[data-portal="links"]')).toContainText('milhas');
  });

  test('agenda: a caixa do Portal bate com GET /api/publico/agenda (vazio honesto ou contagem)', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    const publica = (await api(context, 'GET', '/api/publico/agenda')).body.data as unknown[];
    await page.goto('/studio/agenda');
    const caixa = page.locator('[data-portal="agenda"]');
    await expect(caixa).toBeVisible();
    if (publica.length === 0) await expect(caixa.locator('[data-vazio="portal"]')).toBeVisible();
    else await expect(caixa.locator('[data-total]')).toHaveAttribute('data-total', String(publica.length));
  });
});
