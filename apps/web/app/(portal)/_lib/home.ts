import type { Article } from './types';

/**
 * Blocos de editoria da home (wireframe v1.0: Programas, Bancos, LoyaltyTech). Só 3; a ordem é configurável aqui.
 * Um bloco sem matéria some (nunca vira caixa vazia).
 */
export const HOME_EDITORIAS = ['programas', 'bancos', 'tech'] as const;

/** Quantidades da home compacta (P0-6 da auditoria visual). */
export const HOME_LIMITS = { highlightsSmall: 4, latest: 8, flash: 4, perEditoria: 3 } as const;

/**
 * Deduplicação entre seções: devolve até `limit` itens que ainda não apareceram e os registra em `seen`.
 * A mesma matéria não se repete em Destaques, Últimas, Flash e blocos de editoria.
 */
export function take(items: readonly Article[], seen: Set<string>, limit: number): Article[] {
  const out: Article[] = [];
  for (const a of items) {
    if (out.length >= limit) break;
    if (seen.has(a.slug)) continue;
    seen.add(a.slug);
    out.push(a);
  }
  return out;
}
