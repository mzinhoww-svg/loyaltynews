import type { MoveEntry } from './types';

/**
 * Filtro de texto do Loyalty Moves. A API filtra por id de pessoa/empresa; a busca do leitor é por NOME, então o filtro é
 * aplicado sobre a resposta já carregada (o feed de Moves confirmados é curto). Nada é inventado: sem casamento, a página diz
 * que não há resultado PARA AQUELE FILTRO.
 */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Nomes que a busca cobre: pessoa e as empresas do antes e do depois. */
export function moveTexto(m: MoveEntry): string {
  return [m.person.name, m.before?.company.name ?? '', m.after?.company.name ?? ''].join(' ');
}

export function filterMoves(items: readonly MoveEntry[], q: string): MoveEntry[] {
  const termo = norm(q);
  if (!termo) return [...items];
  return items.filter((m) => norm(moveTexto(m)).includes(termo));
}
