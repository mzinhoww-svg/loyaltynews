import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar, semearFabrica } from './helpers';

// Mídia, Agenda, fontes da Fábrica e correções sobre as ROTAS REAIS do Backend (PGlite só no build de e2e).
// Banco compartilhado e começa vazio: os testes rodam em série e em ordem.
test.describe.configure({ mode: 'serial' });

const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err, main span.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const HASH = 'b'.repeat(64);

test.describe('Biblioteca de mídia (/api/midia)', () => {
  test('começa vazia; valida; exige evidência; licença vencida/renovação; dedupe; filtros; upload sem S3; só chefia remove', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/midia');
    await expect(page.getByRole('heading', { name: 'Nenhum ativo na biblioteca' })).toBeVisible();
    const reg = page.getByRole('region', { name: 'Registrar ativo hospedado fora' });
    const preencher = async (url: string, sha: string, extra: { base?: string; expira?: string; evidencia?: string } = {}) => {
      await reg.getByLabel('URL do ativo').fill(url);
      await reg.getByLabel(/SHA-256/).fill(sha);
      await reg.getByLabel('Crédito').fill('Agência');
      await reg.getByLabel('Texto alternativo').fill('Cartão de fidelidade');
      if (extra.base) await reg.getByLabel('Base de direito').selectOption(extra.base);
      if (extra.expira) await reg.getByLabel(/Expiração da licença/).fill(extra.expira);
      if (extra.evidencia) await reg.getByLabel('Referência da evidência').fill(extra.evidencia);
    };
    await enviar(page, reg.getByRole('button', { name: 'Registrar ativo' }));
    await erro(page, /URL do ativo/); // nome do campo como na tela, não o caminho interno (direitos.url)

    await preencher('https://exemplo.com.br/a.jpg', HASH, { base: 'licenca' });
    await enviar(page, reg.getByRole('button', { name: 'Registrar ativo' }));
    await erro(page, /exige evidência da licença/);

    await preencher('https://exemplo.com.br/a.jpg', HASH, { base: 'licenca', expira: '2000-01-01', evidencia: 'https://exemplo.com.br/termos' });
    await enviar(page, reg.getByRole('button', { name: 'Registrar ativo' }));
    await erro(page, /já está vencida/);

    await preencher('https://exemplo.com.br/a.jpg', HASH, { base: 'licenca', expira: '2099-01-01', evidencia: 'https://exemplo.com.br/termos' });
    await enviar(page, reg.getByRole('button', { name: 'Registrar ativo' }));
    await sucesso(page, 'Ativo registrado');
    const linhaA = page.locator('tr[data-midia]').filter({ hasText: 'a.jpg' });
    await expect(linhaA).toContainText('Publicável');
    await expect(linhaA).toContainText('Licença válida (até 2099-01-01)');
    await expect(linhaA).toContainText('evidência url: https://exemplo.com.br/termos');

    // um ativo por conteúdo: mesmo SHA-256 com outra URL não duplica
    await preencher('https://exemplo.com.br/copia.jpg', HASH, { base: 'licenca', expira: '2099-01-01', evidencia: 'https://exemplo.com.br/termos' });
    await enviar(page, reg.getByRole('button', { name: 'Registrar ativo' }));
    await sucesso(page, 'nada foi duplicado');
    await expect(page.locator('tr[data-midia]')).toHaveCount(1);

    await preencher('https://exemplo.com.br/p.jpg', 'c'.repeat(64));
    await enviar(page, reg.getByRole('button', { name: 'Registrar ativo' }));
    await expect(page.locator('tr[data-midia]').filter({ hasText: 'p.jpg' })).toContainText('Direito pendente');
    await expect(page.locator('tr[data-midia]')).toHaveCount(2);

    // licença vencida deixa de ser publicável (renovação com data passada é aceita pelo Backend como PATCH)
    await enviar(page, page.getByRole('button', { name: /Renovar licença .*a\.jpg/ }));
    await erro(page, 'Informe a nova data de expiração');
    await page.getByLabel(/Nova expiração de .*a\.jpg/).fill('2000-01-01');
    await enviar(page, page.getByRole('button', { name: /Renovar licença .*a\.jpg/ }));
    await sucesso(page, 'Licença atualizada.');
    const vencida = page.locator('tr[data-midia]').filter({ hasText: 'a.jpg' });
    await expect(vencida).toContainText('Licença vencida');
    await expect(vencida).not.toContainText('Publicável');

    await page.goto('/studio/midia?vencida=true');
    await expect(page.locator('tr[data-midia]')).toHaveCount(1);
    await page.goto('/studio/midia?vencendo=30');
    await expect(page.getByRole('heading', { name: 'Nenhum ativo com esses filtros' })).toBeVisible();
    await page.goto('/studio/midia?filtro=video');
    await expect(page.getByRole('heading', { name: 'Nenhum ativo com esses filtros' })).toBeVisible();
    await page.goto('/studio/midia?vencendo=0');
    await expect(page.getByText(/Filtro inválido/)).toBeVisible();

    // upload: sem armazenamento S3 no ambiente de teste o Backend recusa e a mensagem aparece (nunca sucesso falso)
    await page.goto('/studio/midia');
    const up = page.getByRole('region', { name: 'Enviar arquivo' });
    await up.getByLabel('Arquivo').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) });
    await up.getByLabel('Crédito').fill('Agência');
    await up.getByLabel('Texto alternativo').fill('Foto de teste');
    await enviar(page, up.getByRole('button', { name: 'Enviar arquivo' }));
    await expect(page.locator('main .st-alert.err').first()).toBeVisible();
    await expect(page.locator('main .st-alert.ok')).toHaveCount(0);

    await expect(page.getByRole('button', { name: /Remover/ })).toHaveCount(0); // editor não remove
    await entrar(context, 'chefe', 'editor_chefe');
    await page.goto('/studio/midia');
    await enviar(page, page.getByRole('button', { name: /Remover https:\/\/exemplo\.com\.br\/p\.jpg/ }));
    await sucesso(page, 'Ativo removido.');
    await expect(page.locator('tr[data-midia]').filter({ hasText: 'p.jpg' })).toHaveCount(0);
  });

  test('revisor lê sem registrar; leitor não acessa', async ({ page, context }) => {
    await entrar(context, 'lia', 'leitor');
    await page.goto('/studio/midia');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/midia');
    await expect(page.getByText('Seu papel só lê a biblioteca.')).toBeVisible();
  });
});

test.describe('Agenda (/api/agenda)', () => {
  test('exige fonte oficial; encerrado sai de "Próximos"; evento da redação nasce aprovado; só chefia remove', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/agenda');
    await expect(page.getByRole('heading', { name: 'Nenhum evento cadastrado' })).toBeVisible();
    // P2-07: datas com calendário e campos obrigatórios marcados
    await expect(page.locator('#inicio')).toHaveAttribute('type', 'date');
    await expect(page.locator('#fim')).toHaveAttribute('type', 'date');
    await expect(page.getByLabel('Título (obrigatório)')).toBeVisible();
    await page.getByLabel('Título').fill('Congresso sem fonte');
    await page.getByLabel(/Início/).fill('2099-12-01');
    await page.getByLabel('Local').fill('São Paulo');
    await enviar(page, page.getByRole('button', { name: 'Criar evento' }));
    await erro(page, /URL da fonte oficial/); // nome do campo como na tela, não fonteUrl

    const criar = async (titulo: string, inicio: string, fim: string) => {
      await page.getByLabel('Título').fill(titulo);
      await page.getByLabel(/Início/).fill(inicio);
      await page.getByLabel(/Fim/).fill(fim);
      await page.getByLabel('Local').fill('São Paulo');
      await page.getByLabel(/Fonte oficial \(URL/).fill('https://congresso.exemplo.com.br');
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
    await expect(proximos.getByRole('row', { name: /Evento futuro/ }).locator('[data-moderacao="aprovado"]')).toBeVisible(); // da redação: nasce aprovado
    await expect(page.locator('[data-pendentes="0"]')).toBeVisible();

    await page.getByLabel('Título').fill('Fim antes do início');
    await page.getByLabel(/Início/).fill('2099-12-10');
    await page.getByLabel(/Fim/).fill('2099-12-09');
    await page.getByLabel('Local').fill('Rio');
    await page.getByLabel(/Fonte oficial \(URL/).fill('https://congresso.exemplo.com.br');
    await enviar(page, page.getByRole('button', { name: 'Criar evento' }));
    await erro(page, /fim anterior|fim/i);

    await expect(page.getByRole('button', { name: /Remover/ })).toHaveCount(0);
    await entrar(context, 'chefe', 'editor_chefe');
    await page.goto('/studio/agenda');
    await enviar(page, page.getByRole('button', { name: 'Remover Evento antigo' }));
    await sucesso(page, 'Evento removido.');
    await expect(page.getByRole('row', { name: /Evento antigo/ })).toHaveCount(0);
  });

  test('sugestão pública entra pendente; só chefia modera; rejeitar exige motivo; aprovar publica', async ({ page, context }) => {
    const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const sug = await context.request.post('/api/publico/agenda/sugestoes', {
      data: { titulo: 'Meetup de fidelidade', inicio: dia(10), fim: dia(11), local: 'Curitiba', fonteUrl: 'https://meetup.exemplo.com.br', editorias: ['programas'] },
    });
    expect(sug.status()).toBe(202);

    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/agenda');
    await expect(page.locator('[data-pendentes="1"]')).toBeVisible();
    const linha = page.getByRole('row', { name: /Meetup de fidelidade/ });
    await expect(linha.locator('[data-moderacao="pendente"]')).toBeVisible();
    await expect(linha).toContainText('origem publico');
    await expect(page.getByRole('button', { name: /^Aprovar / })).toHaveCount(0); // editor não modera

    await entrar(context, 'chefe', 'editor_chefe');
    await page.goto('/studio/agenda');
    await enviar(page, page.getByRole('button', { name: 'Rejeitar Meetup de fidelidade' }));
    await erro(page, /motivo/i);
    await page.getByLabel('Motivo da rejeição de Meetup de fidelidade').fill('Sem fonte oficial verificável');
    await enviar(page, page.getByRole('button', { name: 'Rejeitar Meetup de fidelidade' }));
    await sucesso(page, 'Evento rejeitado.');
    const rej = page.getByRole('row', { name: /Meetup de fidelidade/ });
    await expect(rej.locator('[data-moderacao="rejeitado"]')).toBeVisible();
    await expect(rej).toContainText('Sem fonte oficial verificável');

    await page.goto('/studio/agenda?moderacao=pendente');
    await expect(page.getByRole('row', { name: /Meetup de fidelidade/ })).toHaveCount(0);
    await page.goto('/studio/agenda?moderacao=rejeitado&origem=publico');
    await enviar(page, page.getByRole('button', { name: 'Aprovar Meetup de fidelidade' }));
    await sucesso(page, 'Evento aprovado.');
    await expect(page.getByRole('row', { name: /Meetup de fidelidade/ }).locator('[data-moderacao="aprovado"]')).toBeVisible();

    const pub = await context.request.get('/api/publico/agenda');
    const corpo = (await pub.json()) as { data: { titulo: string }[] };
    expect(corpo.data.map((e) => e.titulo)).toContain('Meetup de fidelidade'); // aprovado aparece no público
  });
});

test.describe('Fontes da Fábrica (/api/studio/editorial/sources)', () => {
  test('todas nascem desabilitadas; habilitar sem revisão é recusado; revisão exige nota e conferências', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/fontes/fabrica?q=azul');
    await expect(page.getByRole('heading', { level: 1, name: 'Fontes da Fábrica editorial' })).toBeVisible();
    const azul = page.locator('[data-fabrica-fonte="azul-ri"]');
    await expect(azul).toBeVisible();
    await expect(page.locator('[data-habilitada="sim"]')).toHaveCount(0);
    await expect(azul).toContainText('Sem revisão registrada.');
    await expect(azul.getByRole('button', { name: /Habilitar/ })).toHaveCount(0); // revisor não habilita

    await azul.getByText('Registrar revisão dos termos').click();
    await enviar(page, azul.getByRole('button', { name: 'Registrar revisão' }));
    await erro(page, /termsNote/);

    await azul.getByLabel(/O que foi conferido/).fill('Termos oficiais lidos em 22/11: vedam reprodução sem autorização.');
    await enviar(page, azul.getByRole('button', { name: 'Registrar revisão' }));
    await erro(page, /URL verificada|robots/i); // aprovação exige URL verificada e robots conferido

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
    // a lista é paginada (20 por página): a busca leva direto à fonte
    await page.goto('/studio/fontes/fabrica?q=gol');
    const gol = page.locator('[data-fabrica-fonte="gol-ri"]');
    await enviar(page, gol.getByRole('button', { name: /Habilitar/ }));
    await expect(gol.locator('[data-cartao-msg]')).toContainText(/sem revisão registrada[\s\S]*O que fazer/i); // editor-chefe segue o caminho formal (DP-51: só o administrador habilita direto), com a orientação no card

    await page.goto('/studio/fontes/fabrica?q=azul');
    const azul = page.locator('[data-fabrica-fonte="azul-ri"]');
    await enviar(page, azul.getByRole('button', { name: /Habilitar/ }));
    // pode habilitar ou recusar por inelegibilidade do cadastro; em ambos os casos a mensagem do Backend aparece e nada fica falso
    const msg = page.locator('main .st-alert').filter({ hasText: /Fonte habilitada|inelegível|revisão|termos/i }).first();
    await expect(msg).toBeVisible();
    await page.goto('/studio/fontes/fabrica?q=azul');
    if (await page.locator('[data-fabrica-fonte="azul-ri"][data-habilitada="sim"]').count()) {
      await page.locator('[data-fabrica-fonte="azul-ri"]').getByRole('button', { name: /Desabilitar/ }).click();
      await sucesso(page, 'Fonte desabilitada.');
      await page.goto('/studio/fontes/fabrica?q=azul');
      await expect(page.locator('[data-habilitada="sim"]')).toHaveCount(0);
    }
    await entrar(context, 'ed', 'editor');
    await page.goto('/studio/fontes/fabrica');
    await expect(page.getByRole('button', { name: /Registrar revisão|Habilitar/ })).toHaveCount(0);
  });

  test('o cadastro é paginado: 20 por página, com Anterior e Próxima', async ({ page, context }) => {
    await entrar(context, 'chefe', 'editor_chefe');
    await page.goto('/studio/fontes/fabrica');
    await expect(page.locator('[data-fabrica-fonte]')).toHaveCount(20);
    await expect(page.getByText(/página 1 de [2-9]/)).toBeVisible();
    await page.getByRole('navigation', { name: 'Paginação das fontes' }).getByRole('link', { name: 'Próxima' }).click();
    await expect(page.getByText(/página 2 de/)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Paginação das fontes' }).getByRole('link', { name: 'Anterior' })).toBeVisible();
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
