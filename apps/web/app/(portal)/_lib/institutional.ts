/**
 * Conteúdo das páginas institucionais. Fonte: Blueprint 2.0 §2/§3 e Blueprint 2.1 §6.
 * Textos jurídicos são MINUTAS: dependem de parecer (R0-10/F-090) e nunca afirmam fatos não definidos
 * (CNPJ, demais e-mails, redes, o que a hospedagem registra de IP e prazos de resposta ainda não confirmados).
 */
export interface InfoSection {
  heading: string;
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
          'Pessoas e empresas citadas podem pedir correção de um dado, remoção de um dado ou direito de resposta. Cada pedido é analisado pela redação, e a decisão e a data ficam registradas. Quando a resposta é cabível, ela é publicada junto da matéria.',
          'A resposta chega ao e-mail informado no pedido.',
        ],
      },
      {
        heading: 'Créditos e direitos autorais',
        paragraphs: [
          'Todo material de terceiros é creditado. Titulares e autores que identificarem uso indevido podem enviar notificação pelo formulário abaixo; analisamos, retiramos quando cabível e mantemos registro do prazo e da decisão.',
        ],
      },
      {
        heading: 'Pedidos de titulares de dados',
        paragraphs: ['Para pedir correção ou remoção de dados pessoais exibidos no portal, use o formulário desta página (/correcoes#pedido). A resposta chega ao e-mail informado em até 15 dias corridos, com um protocolo para acompanhar. O formulário não cobre acesso, confirmação de tratamento, portabilidade, eliminação de dados fora do portal, revogação de consentimento nem descadastro da newsletter; para esses direitos, use o canal do encarregado indicado na página de Privacidade e LGPD, que lista os direitos e as bases legais.'],
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
    draftNotice: DRAFT,
    sections: [
      {
        heading: 'Controlador e contato do encarregado',
        paragraphs: [
          'O controlador dos dados pessoais tratados neste portal é, por ora, o proprietário do Loyalty News, Aurimar Nogueira, pessoa física. Esta identificação será substituída pela da empresa quando os dados dela forem informados.',
          'O encarregado pelo tratamento de dados pessoais e o canal para falar sobre privacidade é contato@loyaltynews.com.br. Os pedidos de titulares também podem ser feitos pelo formulário em /correcoes#pedido.',
        ],
      },
      {
        heading: 'Quais dados tratamos',
        items: [
          'Leitura do portal: dados técnicos de acesso necessários ao funcionamento e à segurança. A medição de audiência só será ativada com aviso e controle de preferências.',
          'Pedidos de titulares e de correção: nome, e-mail para resposta, endereço da página, tipo e descrição do pedido, usados apenas para analisar e responder.',
          'Pedido de proposta ou de mídia kit (formulário comercial): nome, empresa, e-mail, WhatsApp (opcional), formatos de interesse, objetivo, mensagem, a escolha sobre a newsletter e a data desse consentimento.',
          'Pessoas citadas na seção Intelligence: nome, cargo, empresa e período, só quando publicados por fonte oficial, relevantes e verificados.',
          'Newsletter e preferências, quando existirem: e-mail e escolhas, com consentimento específico.',
        ],
      },
      {
        heading: 'Pedidos comerciais (mídia kit e propostas)',
        items: [
          'Para que usamos: responder ao pedido de proposta ou de mídia kit e conduzir a negociação comercial.',
          'Base legal: procedimentos preliminares a um contrato, a pedido do titular (LGPD, art. 7º, V). A newsletter, que é opcional, só é enviada com consentimento separado (art. 7º, I), e o descadastro é possível a qualquer momento.',
          'Quanto tempo guardamos: nossa política é guardar o pedido que não vira contrato por até 12 meses depois do último contato, e o pedido descartado por 30 dias; o apagamento é automático. Quem se torna cliente tem os dados guardados conforme o contrato e as obrigações legais.',
          'Quem acessa: só a equipe comercial e a administração do portal. Não vendemos esses dados.',
        ],
      },
      {
        heading: 'Endereço IP e segurança',
        paragraphs: [
          'Para limitar tentativas de login e de envio dos formulários públicos e proteger o portal contra abuso, usamos o endereço IP de quem acessa, com base no legítimo interesse em segurança e prevenção a fraude (LGPD, art. 7º, IX). Nas contagens de tentativas de login e de envio dos formulários, o IP não é guardado em claro: ele vira um código irreversível, apagado em até 24 horas depois do fim da contagem ou do bloqueio.',
          'No registro de auditoria do sistema (quem fez o quê no painel interno) guardamos só o código do IP, nunca o número, por 12 meses. Esse código é um pseudônimo e continua sendo dado pessoal: quem tem a chave do sistema consegue ligá-lo ao IP original.',
          'A empresa que hospeda o portal pode registrar IPs nos registros de acesso dela. O que ela guarda e por quanto tempo ainda será confirmado e informado aqui.',
        ],
      },
      {
        heading: 'Princípios',
        items: [
          'Finalidade e minimização: coletamos apenas o necessário.',
          'Newsletter e preferências dependem de consentimento específico, com descadastro em um clique.',
          'Intelligence só publica dados profissionais públicos, relevantes e verificáveis; hierarquia não é inferida como fato.',
          'Não vendemos lista de e-mails.',
        ],
      },
      {
        heading: 'Direitos do titular',
        paragraphs: ['Confirmação, acesso, correção, anonimização, portabilidade, eliminação e revogação do consentimento, nos termos da LGPD. O pedido é feito pelo formulário em /correcoes#pedido, e a resposta chega ao e-mail informado. Quem aparece na seção de pessoas pode pedir correção ou remoção do dado por esse mesmo caminho.'],
      },
      {
        heading: 'Cookies e medição',
        paragraphs: [
          'Medimos a audiência com o Google Analytics 4 (Google LLC) para saber quais páginas são lidas e de onde vêm os leitores, em números agregados. Ele grava cookies no seu navegador (como _ga e _ga_<ID>, por até 2 anos) e envia dados de navegação ao Google.',
          'Os cookies analíticos só são ativados se você clicar em "Aceitar cookies analíticos" no aviso. Sem o aceite, ou se o seu navegador enviar o sinal Global Privacy Control ou Do Not Track, nada é enviado ao Google. A medição não roda fora do site de produção.',
          'Configuramos o GA4 sem dado pessoal: endereço IP anonimizado, sem sinais de publicidade nem personalização de anúncios, e o endereço da página é enviado sem os parâmetros (o que você digita em busca ou formulário não vai ao Google).',
          'Você pode mudar ou revogar a escolha a qualquer momento pelo link "Preferências de cookies" no rodapé. Revogar desliga a coleta a partir dali; os cookies já gravados podem ser apagados nas configurações do navegador.',
          'Versão desta política de cookies: 25/11/2026. Quando ela mudar, pediremos sua escolha de novo.',
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
    lead: 'Fale com a redação, o comercial ou o encarregado de dados.',
    sections: [
      {
        heading: 'Pedidos que já têm canal',
        paragraphs: [
          'Correção ou remoção de um dado, direito de resposta, notificação de direitos autorais e pedidos de titulares de dados: use o formulário de pedidos em /correcoes#pedido. A resposta chega ao e-mail informado no formulário.',
        ],
      },
      {
        heading: 'Demais canais',
        paragraphs: [
          'Assuntos comerciais e de privacidade: contato@loyaltynews.com.br, que também é o canal do encarregado de dados.',
          'Os demais e-mails e as redes sociais oficiais ainda não foram confirmados e não serão exibidos até a configuração oficial. Esta página será atualizada na ativação.',
        ],
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
