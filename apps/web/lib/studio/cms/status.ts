import type { ArticleStatus } from '@ln/contracts';

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  rascunho: 'Rascunho',
  em_checagem: 'Em checagem',
  bloqueado: 'Bloqueado',
  aprovado: 'Aprovado',
  publicado: 'Publicado',
  despublicado: 'Despublicado',
  corrigido: 'Corrigido',
};

export const STATUS_EDITAVEIS: readonly string[] = ['rascunho', 'bloqueado'];
export const TIPOS_CHECAGEM = ['fatos', 'direitos', 'originalidade', 'editor', 'classe_de_dado'] as const;
