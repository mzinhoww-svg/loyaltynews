// Estados de lista do Studio: separa "não há dado" de "a leitura falhou". Hoje uma falha de API virava lista vazia em
// várias telas — e a tela dizia "nenhum X", apresentando erro como zero. Nada é inventado: ou o dado veio, ou a tela diz
// que não conseguiu ler.

export type EstadoDeLista = 'ok' | 'vazio' | 'erro';

/** `erro` vence o total: com a leitura falhando, zero não é fato. */
export function estadoDaLista(temErro: boolean, total: number): EstadoDeLista {
  if (temErro) return 'erro';
  return total === 0 ? 'vazio' : 'ok';
}

export interface VazioHonesto {
  /** O que falta, dito como fato ("Nenhuma campanha criada"). */
  titulo: string;
  /** Por que falta: de onde o dado viria e por que ainda não veio. */
  porque: string;
  /** O caminho para popular: quem faz e onde. */
  comoPopular: string;
}
