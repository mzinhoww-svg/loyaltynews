/**
 * Estados dos tiles do hub /intelligence. Falha de leitura, recurso não publicado nesta versão e módulo publicado sem
 * registro são coisas diferentes — e nenhum deles pode virar um 0 inventado nem uma promessa de data (QA 6/QA 8).
 */
export type Contagem = { status: 'ok' | 'unavailable'; total?: number; available?: boolean; withheld?: number };

/** Rótulo do tile. `withheld` (itens que a API tem mas não publica) vence o vazio, sem expor número. */
export function rotuloContagem(d: Contagem): string {
  if (d.status !== 'ok') return 'Indisponível no momento';
  if ((d.withheld ?? 0) > 0) return 'Existe conteúdo, ainda não publicado nesta versão';
  if (d.available === false) return 'Ainda não publicado nesta versão';
  return (d.total ?? 0) > 0 ? `${d.total} cadastrado(s) e verificado(s)` : 'Nenhum registro publicado ainda';
}

/**
 * `data-count` do tile: só existe quando a leitura deu certo E o recurso está publicado (o zero de um módulo publicado é
 * real). Falha, recurso não publicado ou retido devolvem `null` (atributo ausente): ali o 0 seria inventado.
 */
export function totalPublicado(d: Contagem): number | null {
  if (d.status !== 'ok' || d.available === false || (d.withheld ?? 0) > 0) return null;
  return d.total ?? 0;
}
