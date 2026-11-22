import { createHash } from 'node:crypto';
import { CopyRefusal, MAX_FACT_BULLETS, SIGNATURE, validateCopy } from '../copy/engine';
import { renderPost } from '../creative/post';
import { DEFAULT_FLAGS, type GrowthFlags } from '../flags';
import type { PublishRequest } from '../publisher/publisher';
import type { Article, CreativeAsset } from '../types';

// Instagram: CONSTRUÍDO, flag `growth_instagram_enabled` DESLIGADA (fast-track regra 5; ADR-008; depende de DV-01/P-01).
// A legenda não leva link clicável (usa "link na matéria/bio") e não marca ninguém: marcação exige handle
// verificado do Instagram, que o modelo de entidades ainda não carrega.

export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_HASHTAGS_MAX = 3;

export interface InstagramPackage {
  articleId: string;
  channel: 'instagram';
  /** Estado da chave no momento da montagem. */
  enabled: boolean;
  caption: string;
  feed: CreativeAsset;
  story: CreativeAsset;
  idempotencyKey: string;
  imageRef: string;
  publishRequest: PublishRequest;
  blockers: string[];
  mock: boolean;
}

const TAGS: Record<string, string[]> = {
  'Pontos & Milhas': ['#Milhas', '#Pontos'],
  'Travel & Hospitality': ['#Viagens', '#Fidelidade'],
  'Varejo & Cashback': ['#Cashback', '#Varejo'],
  'Bancos & Cartões': ['#Cartões', '#Fidelidade'],
};

export function generateInstagramCaption(article: Article): string {
  const tags = (TAGS[article.editoria] ?? ['#Fidelidade']).slice(0, INSTAGRAM_HASHTAGS_MAX);
  const lines = [article.title.trim(), ''];
  if (article.deck?.trim()) lines.push(article.deck.trim(), '');
  lines.push(...article.facts.slice(0, MAX_FACT_BULLETS).map((f) => `• ${f.text.trim()}`), '');
  lines.push('Matéria completa no portal Loyalty News (link na bio).');
  if (article.approvedImage?.credit) lines.push(`Imagem: ${article.approvedImage.credit}`);
  lines.push('', `${SIGNATURE} · ${tags.join(' ')}`);
  const caption = lines.join('\n');
  const violations = validateCopy(caption, article, [], { requireLink: false });
  if (caption.length > INSTAGRAM_CAPTION_MAX) {
    violations.push({ rule: 'texto_longo', detail: `${caption.length} > ${INSTAGRAM_CAPTION_MAX}` });
  }
  if (violations.length) throw new CopyRefusal(violations);
  return caption;
}

export function buildInstagramPackage(article: Article, flags: GrowthFlags = DEFAULT_FLAGS): InstagramPackage {
  const caption = generateInstagramCaption(article);
  const feed = renderPost(article, { format: 'vertical' });
  const story = renderPost(article, { format: 'story' });
  const sha = createHash('sha256').update(feed.svg).digest('hex').slice(0, 16);
  const imageRef = `creative://${article.id}/${sha}`;
  const idempotencyKey = `${article.id}:instagram:v1`;
  const blockers: string[] = [];
  if (!flags.growth_instagram_enabled) blockers.push('canal_desligado:instagram');
  if (!article.gatesPassed) blockers.push('gates_automaticos_pendentes');
  if (!article.approvedImage) blockers.push('sem_imagem_aprovada');
  if (article.mock) blockers.push('mock_nao_publicavel');
  if (feed.brandStatus !== 'approved') blockers.push(`brandkit_${feed.brandStatus}`);
  return {
    articleId: article.id,
    channel: 'instagram',
    enabled: flags.growth_instagram_enabled,
    caption,
    feed,
    story,
    idempotencyKey,
    imageRef,
    publishRequest: { article, channel: 'instagram', text: caption, mentions: [], idempotencyKey, imageRef },
    blockers,
    mock: Boolean(article.mock),
  };
}
