/**
 * Conteúdo das páginas institucionais. Fonte: Blueprint 2.0 §2/§3 e Blueprint 2.1 §6.
 * Textos jurídicos são MINUTAS: dependem de parecer (R0-10/F-090) e nunca afirmam fatos não definidos
 * (controlador, e-mail, domínio e redes ainda não confirmados).
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
    title: 'Sobre o Loyalty News',
    lead: 'Veículo especializado em estratégia, tecnologia e economia da fidelização. Nossa missão é contextualizar fatos com rigor, independência e fontes verificáveis.',
    sections: [
      {
        heading: 'O que cobrimos',
        paragraphs: [
          'Programas de fidelidade, pontos e milhas, bancos e cartões, varejo e cashback, travel e hospitality, LoyaltyTech e IA, CRM e CX, Global Loyalty e regulação e dados: dez editorias que formam o mercado brasileiro de fidelização.',
        ],
      },
      {
        heading: 'Como trabalhamos',
        paragraphs: [
          'As matérias são assinadas pela instituição, como Redação Loyalty News. Não criamos repórteres, entrevistas ou apuração presencial que não existam. Quando uma matéria for baseada em documentos e comunicados públicos, ela diz isso e aponta as fontes.',
          'Veja a metodologia, a política editorial e a política de correções para os detalhes.',
        ],
      },
      {
        heading: 'Independência',
        paragraphs: [
          'Publicidade e conteúdo patrocinado são sempre identificados e não influenciam a pauta editorial. Posições de ranking editorial não são vendidas.',
        ],
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
        heading: 'Formatos',
        paragraphs: [
          'Notícia, Loyalty Flash, análise, entrevista, opinião, estudo, conteúdo patrocinado e cobertura de evento. O formato é identificado em cada card e página. Entrevistas só são declaradas quando realizadas; opinião é assinada por autor consentido.',
        ],
      },
      {
        heading: 'Conteúdo patrocinado',
        paragraphs: ['Sempre rotulado de forma ostensiva no card, na página, nas redes e na newsletter.'],
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
          'Erros factuais são corrigidos e registrados no histórico da matéria, com data e descrição. Correções relevantes são propagadas a redes sociais e a perfis relacionados.',
        ],
      },
      {
        heading: 'Créditos e direitos autorais',
        paragraphs: [
          'Todo material de terceiros é creditado. Titulares e autores que identificarem uso indevido podem enviar notificação pelo canal de contato; analisamos, retiramos quando cabível e mantemos registro do prazo e da decisão.',
        ],
      },
      {
        heading: 'Pedidos de titulares de dados',
        paragraphs: ['Para pedir correção ou remoção de dados pessoais, use o formulário desta página (/correcoes#pedido). A resposta chega ao e-mail informado. Os direitos e as bases legais estão na página de privacidade e LGPD.'],
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
        paragraphs: ['A definir antes do lançamento (pendência de governança R1-01). Esta página será atualizada com identificação e canal oficiais.'],
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
        paragraphs: ['Confirmação, acesso, correção, anonimização, portabilidade, eliminação e revogação do consentimento, nos termos da LGPD. O pedido é feito pelo formulário em /correcoes#pedido, e a resposta chega ao e-mail informado.'],
      },
      {
        heading: 'Cookies e medição',
        paragraphs: ['A medição de audiência (GA4) só será ativada com aviso e controle de preferências compatíveis com a LGPD.'],
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
        paragraphs: ['O conteúdo do Loyalty News é protegido por direitos autorais. É permitido citar com crédito e link; reprodução integral exige autorização.'],
      },
      {
        heading: 'Responsabilidade',
        paragraphs: ['As informações têm caráter jornalístico e informativo e não constituem recomendação financeira ou de consumo.'],
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
        heading: 'Canais',
        paragraphs: [
          'Os canais oficiais (e-mail, redes e formulário) ainda não foram confirmados e não serão exibidos até a configuração oficial. Esta página será atualizada na ativação.',
        ],
      },
      {
        heading: 'Assuntos',
        items: [
          'Redação: sugestões de pauta, correções e direito de resposta.',
          'Comercial: propostas e mídia kit.',
          'Titulares de dados: pedidos de acesso, retificação e supressão.',
          'Direitos autorais: notificações de autores e titulares.',
        ],
      },
    ],
  },
};

export const INFO_SLUGS = Object.keys(INFO_DOCS);
