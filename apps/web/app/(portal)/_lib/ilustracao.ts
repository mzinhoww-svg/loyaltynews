import { ILLUSTRATION_CREDIT, ILLUSTRATION_LABEL } from '@ln/contracts';
import { editoriaName } from './editorias';
import type { Article, ArticleImage, ContentType } from './types';

/**
 * F-04: ilustração conceitual padrão para matéria SEM imagem, só em cards e listas (a página da matéria não ganha figura).
 * Arte do Brandkit (public/ilustracoes/*.svg, as mesmas 3 ilustrações de contexto dos cards sociais), sem IA de imagem.
 * Só de exibição: nada é gravado na matéria (a matéria sem imagem segue `mode: 'none'`). Sempre com o rótulo visível "Ilustração conceitual",
 * crédito Loyalty News e alt sem citar IA, modelo ou ferramenta (D09). A imagem publicada da matéria sempre vence.
 * O mapa editoria → ilustração é o dos cards sociais (packages/growth/src/creative/post.ts, CONTEXT_BY_EDITORIA).
 */
export type IlustracaoChave = 'viagem' | 'varejo' | 'pagamentos';

export const ILUSTRACAO_POR_EDITORIA: Record<string, IlustracaoChave> = {
  travel: 'viagem',
  pontos: 'viagem',
  global: 'viagem',
  varejo: 'varejo',
  programas: 'varejo',
  crm: 'varejo',
  bancos: 'pagamentos',
  mercado: 'pagamentos',
  tech: 'pagamentos',
  regulacao: 'pagamentos',
};

/**
 * Tipos que podem receber a ilustração (parecer da Editorial). Análise/autoral, entrevista, opinião, patrocinado (rótulo é do Comercial)
 * e cobertura de evento (o gate editorial proíbe ilustração) ficam só texto. Matéria com correção também fica sem ela, para o selo
 * de correção ser a única marca no card.
 */
export const TIPOS_COM_ILUSTRACAO: readonly ContentType[] = ['noticia', 'flash', 'estudo'];

export const ROTULO_ILUSTRACAO = ILLUSTRATION_LABEL;

/** Imagem a mostrar no card: a publicada, senão a ilustração padrão da editoria (se o tipo permitir), senão nenhuma. */
export function imagemDoCard(article: Article): ArticleImage | undefined {
  if (article.image?.src) return article.image;
  const chave = ILUSTRACAO_POR_EDITORIA[article.editoriaSlug];
  if (!chave || !TIPOS_COM_ILUSTRACAO.includes(article.contentType) || article.corrections?.length) return undefined;
  return {
    src: `/ilustracoes/${chave}.svg`,
    alt: `${ROTULO_ILUSTRACAO} de ${editoriaName(article.editoriaSlug)}`,
    credit: ILLUSTRATION_CREDIT,
    label: ROTULO_ILUSTRACAO,
  };
}
