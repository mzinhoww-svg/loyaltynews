/**
 * Conteúdo das páginas institucionais. Fonte: Blueprint 2.0 §2/§3 e Blueprint 2.1 §6.
 * Textos jurídicos são MINUTAS: dependem de validação jurídica (R0-10/F-090) e nunca afirmam fatos não definidos
 * (endereço e nome do encarregado, demais e-mails, redes, o que a hospedagem registra de IP). Razão social e CNPJ: DP-68.
 */
import { EMPRESA } from './contato';

export interface InfoSection {
  heading: string;
  /** Âncora da seção (ex.: /privacidade#cookies). */
  id?: string;
  paragraphs?: string[];
  items?: string[];
}
export interface InfoDoc {
  slug: string;
  title: string;
  lead: string;
  /** Presente em minutas jurídicas a validar. */
  draftNotice?: string;
  sections: InfoSection[];
}

const DRAFT =
  'Minuta v0.1 sujeita à validação jurídica antes do lançamento. Registro de versão e última atualização será exibido quando o texto for aprovado.';

export const INFO_DOCS: Record<string, InfoDoc> = {
  sobre: {
    slug: 'sobre',
    title: 'Quem somos',
    lead: 'O Loyalty News é um veículo especializado em estratégia, tecnologia e economia da fidelização. Nossa missão é contextualizar fatos com rigor, independência e fontes verificáveis.',
    sections: [
      {
        heading: 'O que cobrimos',
        paragraphs: [
          'Programas de fidelidade, pontos e milhas, bancos e cartões, varejo e cashback, travel e hospitality, LoyaltyTech e IA, CRM e CX, Global Loyalty e regulação e dados: dez editorias que formam o mercado brasileiro de fidelização, com olhar também para o que acontece fora do Brasil.',
        ],
      },
      {
        heading: 'Quem produz',
        paragraphs: [
          'As matérias são assinadas pela instituição, como Redação Loyalty News. A assinatura é institucional: não criamos repórteres, entrevistas ou apuração presencial que não existam.',
          'Usamos automação e inteligência artificial em etapas do processo: leitura das fontes públicas, redação, checagem e revisão. A equipe editorial define as fontes, a pauta e os limites, acompanha o resultado e corrige ou retira o que estiver errado. Detalhes na metodologia e na política editorial.',
        ],
      },
      {
        heading: 'De onde vem a informação',
        paragraphs: [
          'Priorizamos fontes primárias e públicas: comunicados oficiais, relações com investidores, regulamentos de programas, órgãos reguladores, governo e associações do setor. Blogs e a imprensa especializada ajudam a descobrir assuntos, mas um fato só vira matéria quando há fonte primária. Cada matéria lista as fontes, com link e data.',
        ],
      },
      {
        heading: 'Independência',
        paragraphs: [
          'Publicidade e conteúdo patrocinado são sempre identificados e não influenciam a pauta editorial. Posições de ranking editorial não são vendidas.',
        ],
      },
      {
        heading: 'Fale com a gente',
        paragraphs: ['Correções, direito de resposta, pedidos sobre dados pessoais e demais assuntos: veja a página de contato e o formulário de pedidos em correções.'],
      },
    ],
  },
  metodologia: {
    slug: 'metodologia',
    title: 'Metodologia editorial',
    lead: 'Como uma informação vira matéria no Loyalty News: da captura da fonte à verificação e à correção.',
    sections: [
      {
        heading: 'Fontes',
        items: [
          'Priorizamos fontes primárias: comunicados oficiais, relações com investidores, regulamentos de programas, órgãos reguladores e associações do setor.',
          'A coleta usa páginas públicas, sem contornar paywall ou login e respeitando termos de uso e limites técnicos. Registramos URL, data e fonte.',
        ],
      },
      {
        heading: 'Verificação',
        items: [
          'Cada afirmação material precisa de uma fonte. Sem lastro, a pauta não é publicada.',
          'A verificação de afirmações é feita por um processo independente da redação do texto.',
          'Não reproduzimos expressão textual protegida por mera substituição de palavras: compomos o texto a partir de fatos verificados e contexto próprio, com créditos e links.',
        ],
      },
      {
        heading: 'Imagens e direitos',
        paragraphs: [
          'Imagens exigem base de utilização demonstrável (licença, autorização, domínio público ou exceção validada), com crédito e link. Na dúvida, não publicamos.',
        ],
      },
      {
        heading: 'Uso de automação',
        paragraphs: [
          'O Loyalty News usa automação e ferramentas de inteligência artificial em etapas do processo editorial. Perguntas diretas sobre esse uso são respondidas com transparência pelo responsável. Quando a lei, uma plataforma ou a relevância material exigir, o uso é informado na própria matéria.',
        ],
      },
    ],
  },
  'politica-editorial': {
    slug: 'politica-editorial',
    title: 'Política editorial',
    lead: 'Princípios que orientam o que publicamos e como separamos jornalismo de publicidade.',
    sections: [
      {
        heading: 'Princípios',
        items: [
          'Rigor: fatos atribuídos e verificáveis; contexto brasileiro; sem sensacionalismo.',
          'Independência: decisões editoriais são separadas das comerciais.',
          'Transparência: autoria institucional verdadeira, fontes expostas, correções visíveis.',
          'Responsabilidade: dados pessoais e profissionais só são publicados quando relevantes, verificados e com base de tratamento.',
        ],
      },
      {
        heading: 'Fontes e atribuição',
        items: [
          'Toda matéria lista as fontes usadas, com link, e atribui cada afirmação a quem a fez ("segundo...").',
          'Números, datas, valores e citações só entram no texto quando constam na fonte. O que não está na fonte não é afirmado.',
          'Citação literal é curta, entre aspas e atribuída. Não copiamos o texto das fontes nem o disfarçamos trocando palavras: escrevemos com palavras próprias a partir dos fatos.',
          'Blogs e imprensa especializada servem de pista de pauta. Para virar matéria, o fato precisa de fonte primária citada.',
        ],
      },
      {
        heading: 'Autoria e uso de inteligência artificial',
        paragraphs: [
          'As matérias levam a assinatura Redação Loyalty News. Não inventamos autores, entrevistas, falas ou métricas. Usamos automação e inteligência artificial para ler fontes públicas, redigir, checar e revisar; a checagem das afirmações é feita por um processo independente do que redigiu o texto, e a equipe editorial responde pelo que é publicado.',
        ],
      },
      {
        heading: 'Formatos',
        paragraphs: [
          'Notícia, Loyalty Flash, análise, entrevista, opinião, estudo, conteúdo patrocinado e cobertura de evento. O formato é identificado em cada card e página. Entrevistas só são declaradas quando realizadas; opinião é assinada por autor consentido.',
          'Conteúdo autoral é a análise própria da redação, feita só a partir de fontes oficiais citadas ao final; leva um aviso no início, não traz falas e não é recomendação de compra, investimento ou contratação.',
        ],
      },
      {
        heading: 'Imagens e ilustrações',
        paragraphs: [
          'Só publicamos imagem com base de uso demonstrável (licença, autorização, domínio público ou exceção validada), com crédito e link. Na dúvida, não publicamos. Quando uma matéria não tem imagem, a vitrine pode exibir uma ilustração conceitual, sempre rotulada como "Ilustração conceitual" e creditada ao Loyalty News; ela não é registro de um fato.',
        ],
      },
      {
        heading: 'Conteúdo patrocinado',
        paragraphs: ['Sempre rotulado de forma ostensiva no card, na página, nas redes e na newsletter. Conteúdo patrocinado não é produzido pela redação.'],
      },
      {
        heading: 'Erros e correções',
        paragraphs: ['Erros são corrigidos de forma visível. Veja como pedir correção e como funciona o direito de resposta na página de correções.'],
      },
    ],
  },
  correcoes: {
    slug: 'correcoes',
    title: 'Direitos, créditos e correções',
    lead: 'Como corrigimos erros, creditamos materiais e tratamos pedidos de titulares e autores.',
    sections: [
      {
        heading: 'Correções',
        paragraphs: [
          'Erros factuais são corrigidos e registrados no histórico da matéria, com data e descrição do que mudou. Correções relevantes são propagadas a redes sociais e a perfis relacionados. Em caso de dúvida sobre um dado, preferimos retirar ou corrigir a manter.',
        ],
      },
      {
        heading: 'Direito de resposta e pedidos de remoção',
        paragraphs: [
          'Pessoas e empresas citadas podem pedir correção de um dado, remoção de um dado ou direito de resposta. Correção e remoção são pedidas pelo formulário desta página; o direito de resposta, por contato@loyaltynews.com.br. Cada pedido é analisado pela redação, e a decisão e a data ficam registradas. Quando a resposta é cabível, ela é publicada junto da matéria.',
          'A resposta chega ao e-mail informado no pedido.',
        ],
      },
      {
        heading: 'Créditos e direitos autorais',
        paragraphs: [
          'Todo material de terceiros é creditado. Titulares e autores que identificarem uso indevido podem enviar notificação para contato@loyaltynews.com.br; analisamos, retiramos quando cabível e mantemos registro do prazo e da decisão.',
        ],
      },
      {
        heading: 'Pedidos de titulares de dados',
        paragraphs: ['Para pedir correção ou remoção de dados pessoais exibidos no portal, use o formulário desta página (/correcoes#pedido). Ele pede só seu nome, um e-mail para resposta, o endereço da página, o tipo do pedido e a descrição. A resposta chega ao e-mail informado em até 15 dias corridos, com um protocolo para acompanhar. O formulário não cobre acesso, confirmação de tratamento, portabilidade, eliminação de dados fora do portal, revogação de consentimento nem descadastro da newsletter; para esses direitos, escreva para contato@loyaltynews.com.br, como indica a página de Privacidade e LGPD.'],
      },
      {
        heading: 'Histórico de correções',
        paragraphs: ['Ainda não há correções registradas: o portal não publicou matérias.'],
      },
    ],
  },
  privacidade: {
    slug: 'privacidade',
    title: 'Privacidade e LGPD',
    lead: 'Como tratamos dados pessoais de leitores, assinantes e pessoas citadas.',
    // Texto aprovado pelo proprietário (DP-68); desvios por mudança de código ou de decisão estão em institucional-lancamento.test.ts.
    draftNotice: 'Minuta v0.5, sujeita à validação jurídica.',
    sections: [
      {
        heading: '1. Quem responde pelos seus dados',
        paragraphs: [
          'O controlador dos dados pessoais tratados neste portal é a REINERS MEDIA LTDA, CNPJ 66.084.338/0001-87.',
          'O canal para falar sobre privacidade é contato@loyaltynews.com.br. O nome da pessoa encarregada ainda não foi informado.',
        ],
      },
      {
        heading: '2. Quais dados tratamos',
        items: [
          'Leitura do portal: dados técnicos de acesso necessários ao funcionamento e à segurança. A medição de audiência depende da sua escolha (item 8).',
          'Pedido de correção ou remoção: nome, e-mail para resposta, endereço da página, tipo e descrição do pedido.',
          'Direito de resposta: matéria, trecho contestado, data e histórico do pedido, nome, contato (se informado), texto enviado e, se houver, a verificação de identidade (item 5).',
          'Pedido de proposta ou de mídia kit: nome, empresa, e-mail, WhatsApp (opcional), objetivo, mensagem (opcional), sua marcação sobre a newsletter, data, hora e situação do pedido.',
          'Contatos comerciais registrados pela nossa equipe: nome, e-mail, WhatsApp, cargo, base legal, data e quem registrou.',
          'Pessoas citadas na seção Intelligence: nome, cargo, empresa e período. Publicamos apenas dados profissionais de fonte oficial, relevantes e verificados.',
          'Painel interno: dados das pessoas autorizadas a publicar e um código do e-mail digitado em cada tentativa de acesso (item 7).',
          'Newsletter: a inscrição na The Loyal está fechada. No pedido comercial registramos, se você marcar, o interesse na newsletter. Nada é enviado hoje.',
        ],
      },
      {
        heading: '3. Pedidos comerciais',
        paragraphs: [
          'Usamos os dados para responder ao pedido de proposta ou de mídia kit e conduzir a negociação. A base legal são os procedimentos preliminares a um contrato, a seu pedido (LGPD, art. 7º, V). Uma newsletter só poderá ser enviada com o seu consentimento separado (art. 7º, I).',
          'Têm acesso a equipe comercial e a administração do portal. Não vendemos esses dados.',
          'Hoje não há apagamento automático em funcionamento nem opção no painel para excluir um pedido: os dados permanecem guardados. Para pedir a exclusão, escreva para contato@loyaltynews.com.br; o atendimento é manual.',
          'Os contatos comerciais registrados pela equipe também não têm prazo de exclusão nem rotina de apagamento.',
        ],
      },
      {
        heading: '4. Correção e remoção de dados',
        paragraphs: [
          'Use o formulário em /correcoes#pedido. Usamos os dados para analisar e responder. Um pedido idêntico que ainda esteja em aberto não é registrado duas vezes, e há limite de envios por contato. Têm acesso aos pedidos a administração e a chefia de redação.',
          'O portal informa um protocolo e prazo de resposta de até 15 dias corridos. A resposta é feita por uma pessoa, no e-mail informado; não há envio automático.',
          'A decisão pode corrigir ou ocultar a exibição pública de uma pessoa, de um cargo ou de uma movimentação identificada pelo endereço da página. O registro continua armazenado. Não há prazo nem rotina para apagar o pedido.',
          'No registro de auditoria, o recebimento guarda o identificador e o tipo do pedido, sem nome, e-mail ou texto. A decisão guarda também o motivo escrito pela equipe. As linhas da auditoria não são apagadas.',
        ],
      },
      {
        heading: '5. Direito de resposta',
        paragraphs: [
          'Pessoas e empresas citadas podem pedir direito de resposta escrevendo para contato@loyaltynews.com.br. Quando o pedido é registrado no sistema, guardamos a matéria, o trecho contestado, a data, o histórico do caso, o nome, o contato (se informado) e o texto enviado. Se confirmarmos sua identidade, registramos como e por quem; esse registro entra numa auditoria que não é apagada. Ainda não há prazo definido nem rotina de exclusão para o pedido. Se o direito de resposta for aceito, publicamos junto da matéria um aviso datado, que pode trazer o seu nome e o texto enviado.',
        ],
      },
      {
        heading: '6. Seus direitos',
        paragraphs: [
          'A LGPD garante, entre outros, confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação e revogação do consentimento. Correção e remoção de dado exibido no portal: formulário em /correcoes#pedido. Os demais direitos: contato@loyaltynews.com.br. O atendimento é manual, e alguns registros, como a auditoria, não são apagados. Para mudar sua escolha sobre cookies, use "Preferências de cookies" no rodapé.',
        ],
      },
      {
        heading: '7. Painel interno',
        paragraphs: [
          'Para as pessoas autorizadas a publicar, guardamos nome, e-mail, papel, situação de bloqueio, a senha em forma protegida (hash), os dados do segundo fator, o token da sessão e a identificação do navegador usado. A sessão não guarda o endereço IP. Ela expira após 12 horas sem uso e é renovada enquanto usada; sessões vencidas não são apagadas automaticamente.',
          'Cada tentativa de login (certa, errada ou bloqueada) grava na auditoria um código no lugar do e-mail digitado, mesmo que não exista conta com ele. Esse código é um pseudônimo e continua sendo dado pessoal. Registros anteriores a essa mudança guardam o e-mail digitado; eles não são apagados, e a consulta pelo painel o oculta.',
          'A auditoria registra quem fez o quê: autor, papel, ação, item afetado e detalhes. Senhas, códigos de acesso e textos com endereço de e-mail são removidos; os detalhes podem conter motivos escritos pela equipe. Essas linhas não são apagadas. Podem lê-la a administração e a chefia de redação, e a leitura também é registrada. A conta de administrador pode ser removida por procedimento técnico; para os demais papéis ainda não há rotina de exclusão.',
        ],
      },
      {
        heading: '8. Cookies e medição de audiência',
        id: 'cookies',
        paragraphs: [
          'Usamos o Google Analytics 4 (Google LLC) para saber quais páginas são lidas e de onde vêm os leitores. Ele só é ativado se você clicar em "Aceitar cookies analíticos". Sem o aceite, ou com o sinal Global Privacy Control ou Do Not Track ligado no navegador, não o carregamos. A medição não roda fora do site de produção.',
          'Quando ativado, ele grava cookies (como _ga e _ga_<ID>) e envia ao Google dados de navegação e identificadores, que são dados pessoais. Não ativamos sinais de publicidade nem personalização de anúncios. Informamos o endereço da página atual sem os parâmetros; o endereço da página anterior pode ser enviado pela ferramenta e conter, por exemplo, um termo de busca. O prazo dos cookies depende da configuração do Google Analytics e ainda será confirmado.',
          'Sua escolha fica guardada no próprio navegador, com a data e a versão da política. Você pode mudá-la pelo link "Preferências de cookies". Revogar interrompe a coleta dali em diante; os cookies já gravados podem ser apagados nas configurações do navegador. O envio ao Google pode transferir dados para fora do Brasil; a base legal e as garantias dessa transferência ainda serão definidas.',
        ],
      },
      {
        heading: '9. Segurança e endereço IP',
        paragraphs: [
          'Usamos senha protegida por hash, segundo fator obrigatório no painel, controle de acesso por papel e auditoria. Para segurança e prevenção a fraude, com base no legítimo interesse (art. 7º, IX), limitamos tentativas de acesso ao painel por conta e envios do formulário de correção por contato. Essas contagens guardam um código no lugar do e-mail. Esse código é um pseudônimo e continua sendo dado pessoal. A limpeza periódica dessas contagens ainda não está ativa. A auditoria de login também guarda um código no lugar do e-mail e não é apagada (item 7).',
          'Hoje o sistema do portal não usa o seu endereço IP para limitar tentativas nem registra código de IP na auditoria. As empresas que fazem o site funcionar podem registrar o IP nos registros de acesso delas; o que guardam e por quanto tempo ainda será confirmado.',
          'Nenhum sistema é infalível.',
        ],
      },
      {
        heading: '10. Quem mais processa os dados',
        paragraphs: [
          'O site passa pela rede da Cloudflare e usa a hospedagem e os bancos de dados da Vertra. O Google recebe dados de medição quando você aceita. Os países de processamento, os contratos e a existência e o prazo de cópias de segurança ainda serão confirmados. Também será confirmado se nomes de pessoas citadas passam por fornecedores de inteligência artificial na produção das matérias.',
        ],
      },
      {
        heading: '11. Alterações',
        paragraphs: [
          'Versão 0.5, aprovada em 27/11/2026.',
        ],
      },
    ],
  },
  termos: {
    slug: 'termos',
    title: 'Termos de uso',
    lead: 'Condições para acessar e usar o conteúdo do portal.',
    draftNotice: DRAFT,
    sections: [
      {
        heading: 'Uso do conteúdo',
        paragraphs: ['O conteúdo do Loyalty News é protegido por direitos autorais. É permitido citar com crédito e link; reprodução integral exige autorização. Textos, dados e fontes de terceiros citados em nossas matérias pertencem aos seus titulares.'],
      },
      {
        heading: 'Natureza das informações',
        paragraphs: ['As informações têm caráter jornalístico e informativo e não constituem recomendação financeira ou de consumo. Ofertas, bônus, prazos e regras de programas mudam: confira sempre na fonte citada antes de decidir.'],
      },
      {
        heading: 'Publicidade e links',
        paragraphs: ['Anúncios e conteúdos patrocinados são identificados. Links para sites de terceiros não significam endosso, e não respondemos pelo conteúdo deles.'],
      },
      {
        heading: 'Responsabilidade',
        paragraphs: ['Corrigimos erros quando os identificamos ou quando nos são informados, nos termos da política de correções. O portal pode ficar indisponível temporariamente por manutenção ou falha.'],
      },
      {
        heading: 'Empresa',
        paragraphs: [`Razão social: ${EMPRESA.razaoSocial}. CNPJ: ${EMPRESA.cnpj}.`],
      },
      {
        heading: 'Alterações',
        paragraphs: ['Os termos serão versionados; a versão vigente e a data de atualização serão exibidas nesta página.'],
      },
    ],
  },
  publicidade: {
    slug: 'publicidade',
    title: 'Política de publicidade e independência editorial',
    lead: 'Como a publicidade convive com a independência editorial.',
    draftNotice: DRAFT,
    sections: [
      {
        heading: 'Separação',
        paragraphs: ['Decisões editoriais e comerciais são separadas. Anunciantes não aprovam, alteram ou antecipam conteúdo editorial.'],
      },
      {
        heading: 'Identificação',
        paragraphs: ['Anúncios e conteúdos patrocinados têm rótulo claro. Posições de ranking editorial (Em alta, Destaques) não são vendidas; destaque pago aparece em componente separado e identificado.'],
      },
      {
        heading: 'Anuncie',
        paragraphs: ['Veja formatos e como falar com o comercial no mídia kit.'],
      },
    ],
  },
  contato: {
    slug: 'contato',
    title: 'Contato',
    lead: 'Fale com a redação ou o comercial e trate de privacidade e dados pessoais.',
    sections: [
      {
        heading: 'Pedidos que já têm canal',
        paragraphs: [
          'Correção ou remoção de um dado exibido no portal: use o formulário de pedidos em /correcoes#pedido. A resposta chega ao e-mail informado no formulário.',
          'Notificação de direitos autorais, direito de resposta e demais pedidos de titulares de dados: escreva para contato@loyaltynews.com.br.',
        ],
      },
      {
        heading: 'Demais canais',
        paragraphs: [
          'Assuntos comerciais e de privacidade: contato@loyaltynews.com.br.',
          'Os demais e-mails e as redes sociais oficiais ainda não foram confirmados e não serão exibidos até a configuração oficial. Esta página será atualizada na ativação.',
        ],
      },
      {
        heading: 'Empresa',
        paragraphs: [`Razão social: ${EMPRESA.razaoSocial}. CNPJ: ${EMPRESA.cnpj}.`],
      },
      {
        heading: 'Assuntos',
        items: [
          'Redação: sugestões de pauta, correções e direito de resposta.',
          'Comercial: propostas e mídia kit (veja a página de publicidade).',
          'Titulares de dados: pedidos de acesso, retificação e supressão.',
          'Direitos autorais: notificações de autores e titulares.',
        ],
      },
    ],
  },
};

export const INFO_SLUGS = Object.keys(INFO_DOCS);
