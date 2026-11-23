import { EDITORIAS as CONTRACT_EDITORIAS, type EditoriaSlug } from '@ln/contracts';
import type { Editoria } from './types';

/**
 * As dez editorias vêm de `@ln/contracts` (slug e nome canônicos, Blueprint 2.1 §1).
 * Aqui só se acrescenta a descrição pública (Blueprint 2.0 §2), que é texto de apresentação do portal.
 */
const DESCRIPTIONS: Record<EditoriaSlug, string> = {
  mercado: 'Movimentos, fusões, resultados e estratégia do mercado de fidelização.',
  programas: 'Mecânica, parcerias, tiers, clubes e ecossistemas dos programas.',
  pontos: 'Acúmulo, resgate, precificação, transferências, validade e economia dos pontos.',
  bancos: 'Co-branded, rewards, cartões premium, conta global e pagamentos.',
  varejo: 'Frequência, benefícios, assinatura, marketplaces e retail media.',
  travel: 'Companhias aéreas, hotéis, OTAs e experiências.',
  tech: 'Plataformas, dados, antifraude, personalização, gamificação e infraestrutura.',
  crm: 'Jornada, retenção, CLV, engajamento e omnichannel.',
  global: 'Benchmark estrangeiro com recorte aplicável ao Brasil.',
  regulacao: 'Defesa do consumidor, LGPD, regras de programas e regulação financeira adjacente.',
};

export const EDITORIAS: readonly Editoria[] = CONTRACT_EDITORIAS.map((e) => ({
  slug: e.slug,
  name: e.nome,
  description: DESCRIPTIONS[e.slug],
}));

export function getEditoria(slug: string): Editoria | undefined {
  return EDITORIAS.find((e) => e.slug === slug);
}
export function editoriaName(slug: string): string {
  return getEditoria(slug)?.name ?? slug;
}

/** Slug da editoria exibida no menu como "Tecnologia" (LoyaltyTech & IA). */
export const TECH_EDITORIA_SLUG: EditoriaSlug = 'tech';

export const CONTENT_TYPE_LABEL = {
  noticia: 'Notícia',
  flash: 'Loyalty Flash',
  analise: 'Análise',
  entrevista: 'Entrevista',
  opiniao: 'Opinião',
  estudo: 'Estudo',
  patrocinado: 'Conteúdo patrocinado',
  cobertura_evento: 'Cobertura de evento',
} as const;
