// MOCK — réplica do CONTRATO de consumeArticle (packages/intelligence, ft/intelligence 8bba2d9) para testar a interface
// sem importar o outro pacote. Valida a forma da entrada como o consumidor real faz e rejeita chaves desconhecidas.
import type { PublishedArticle, RoleMention } from '../src/intelligence/types';
import { PUBLISHED_ARTICLE_KEYS, ROLE_MENTION_KEYS } from '../src/intelligence/types';

export type MockConsume =
  | { status: 'skipped'; reason: 'not_published' | 'already_ingested' | 'no_mentions' | 'invalid_article' | 'unknown_keys'; issues?: string[] }
  | { status: 'organizations_only'; organizations: string[]; persons_skipped: number; storedText: string }
  | { status: 'ingested'; observations: Array<{ personName: string; orgName: string; title: string; kind: string; announced: boolean; effectiveDate?: string }>; storedText: string };

const seen = new Set<string>();
export const resetMockConsumer = () => seen.clear();

export function consumeArticleMock(input: { article: PublishedArticle; mentions?: RoleMention[] }, cfg: { personIngestion: boolean }): MockConsume {
  const { article, mentions = [] } = input;
  const bad = [
    ...Object.keys(article).filter((k) => !(PUBLISHED_ARTICLE_KEYS as readonly string[]).includes(k)),
    ...mentions.flatMap((m) => Object.keys(m).filter((k) => !(ROLE_MENTION_KEYS as readonly string[]).includes(k))),
  ];
  if (bad.length) return { status: 'skipped', reason: 'unknown_keys', issues: bad };
  if (article.status !== 'published') return { status: 'skipped', reason: 'not_published' };
  const issues: string[] = [];
  if (!/^https?:\/\/\S+$/i.test(article.url ?? '')) issues.push('url');
  if (!article.sourceName?.trim()) issues.push('sourceName');
  if (!article.fetchedAt || Number.isNaN(Date.parse(article.fetchedAt))) issues.push('fetchedAt');
  if (issues.length) return { status: 'skipped', reason: 'invalid_article', issues };
  if (mentions.length === 0) return { status: 'skipped', reason: 'no_mentions' };
  if (mentions.some((m) => m.excerpt.length > 500)) return { status: 'skipped', reason: 'invalid_article', issues: ['excerpt'] };
  const key = `${article.url}|${article.contentSha256 ?? ''}`;
  if (article.contentSha256 && seen.has(key)) return { status: 'skipped', reason: 'already_ingested' };
  seen.add(key);
  // o que o consumidor real persistiria como evidência (excerpt/headline) — usado para provar que nome de pessoa não vaza
  const storedText = JSON.stringify([article.headline ?? mentions[0]!.excerpt, ...mentions.map((m) => m.excerpt)]);
  if (!cfg.personIngestion) {
    return { status: 'organizations_only', organizations: [...new Set(mentions.map((m) => m.orgName.trim()).filter(Boolean))].sort(), persons_skipped: mentions.length, storedText: JSON.stringify([article.headline ?? mentions[0]!.excerpt]) };
  }
  return {
    status: 'ingested', storedText,
    observations: mentions.map((m) => ({ personName: m.personName, orgName: m.orgName, title: m.title, kind: m.kind, announced: m.announced === true, ...(m.effectiveDate ? { effectiveDate: m.effectiveDate } : {}) })),
  };
}
