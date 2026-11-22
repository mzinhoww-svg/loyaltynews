import type { Editoria } from './types';

/** As dez editorias (Blueprint 2.1 §1; descrições: Blueprint 2.0 §2). */
export const EDITORIAS: readonly Editoria[] = [
  { slug: 'mercado-e-negocios', name: 'Mercado & Negócios', description: 'Movimentos, fusões, resultados e estratégia do mercado de fidelização.' },
  { slug: 'programas-de-fidelidade', name: 'Programas de Fidelidade', description: 'Mecânica, parcerias, tiers, clubes e ecossistemas dos programas.' },
  { slug: 'pontos-e-milhas', name: 'Pontos & Milhas', description: 'Acúmulo, resgate, precificação, transferências, validade e economia dos pontos.' },
  { slug: 'bancos-e-cartoes', name: 'Bancos & Cartões', description: 'Co-branded, rewards, cartões premium, conta global e pagamentos.' },
  { slug: 'varejo-e-cashback', name: 'Varejo & Cashback', description: 'Frequência, benefícios, assinatura, marketplaces e retail media.' },
  { slug: 'travel-e-hospitality', name: 'Travel & Hospitality', description: 'Companhias aéreas, hotéis, OTAs e experiências.' },
  { slug: 'loyaltytech-e-ia', name: 'LoyaltyTech & IA', description: 'Plataformas, dados, antifraude, personalização, gamificação e infraestrutura.' },
  { slug: 'crm-e-cx', name: 'CRM & CX', description: 'Jornada, retenção, CLV, engajamento e omnichannel.' },
  { slug: 'global-loyalty', name: 'Global Loyalty', description: 'Benchmark estrangeiro com recorte aplicável ao Brasil.' },
  { slug: 'regulacao-e-dados', name: 'Regulação & Dados', description: 'Defesa do consumidor, LGPD, regras de programas e regulação financeira adjacente.' },
];

export function getEditoria(slug: string): Editoria | undefined {
  return EDITORIAS.find((e) => e.slug === slug);
}
export function editoriaName(slug: string): string {
  return getEditoria(slug)?.name ?? slug;
}

export const CONTENT_TYPE_LABEL = {
  noticia: 'Notícia',
  flash: 'Loyalty Flash',
  analise: 'Análise',
  entrevista: 'Entrevista',
  opiniao: 'Opinião',
} as const;
