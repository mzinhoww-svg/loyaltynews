import type { Article, HomeBlock, SiteEvent } from './types';

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

export interface PreparedSection {
  kind: 'destaque' | 'lista_editoria' | 'ultimas';
  id: string;
  title?: string;
  editoriaSlug?: string;
  articles: Article[];
}
export interface PreparedHome {
  /** Primeiro bloco `destaque` com matérias: vira o hero (1 grande + até 4 pequenas). */
  hero: { title?: string; articles: Article[] } | null;
  /** Demais blocos com matérias, na ordem publicada. */
  sections: PreparedSection[];
  /** Bloco `agenda` com eventos (vai para a lateral). */
  agenda: { title?: string; events: SiteEvent[] } | null;
  /** Posições publicitárias publicadas (só renderizam com criativo real no inventário). */
  adPositions: string[];
  hasContent: boolean;
}

/**
 * Home publicada no Studio → estrutura renderizável. A ordem e os títulos são do editor; o portal só deduplica matérias entre
 * blocos (a mesma matéria não se repete) e descarta blocos que ficaram sem conteúdo (nunca caixa vazia).
 */
export function prepareHome(blocks: readonly HomeBlock[]): PreparedHome {
  const seen = new Set<string>();
  const out: PreparedHome = { hero: null, sections: [], agenda: null, adPositions: [], hasContent: false };
  for (const b of blocks) {
    if (b.type === 'publicidade') {
      out.adPositions.push(b.position);
    } else if (b.type === 'agenda') {
      if (!out.agenda && b.events.length > 0) out.agenda = { title: b.title, events: b.events };
    } else {
      const articles = take(b.articles, seen, b.articles.length);
      if (articles.length === 0) continue;
      if (b.type === 'destaque' && !out.hero) out.hero = { title: b.title, articles: articles.slice(0, 1 + HOME_LIMITS.highlightsSmall) };
      else out.sections.push({ kind: b.type, id: b.id, title: b.title, editoriaSlug: b.type === 'lista_editoria' ? b.editoriaSlug : undefined, articles });
    }
  }
  out.hasContent = out.hero !== null || out.sections.length > 0 || out.agenda !== null;
  return out;
}
