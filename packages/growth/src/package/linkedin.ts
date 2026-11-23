import { createHash } from 'node:crypto';
import { generateLinkedInCopy, type LinkedInCopy } from '../copy/engine';
import { CreativeRefusal } from '../creative/post';
import { renderSocialCard, type SocialCardFormat, type SocialCardInput } from '../creative/social-cards';
import type { PublishRequest } from '../publisher/publisher';
import type { CreativeAsset } from '../types';

export interface CarouselSlide {
  index: number;
  kind: 'capa' | 'fato' | 'fechamento';
  svg: string;
}

export interface LinkedInPackage {
  articleId: string;
  channel: 'linkedin';
  copy: LinkedInCopy;
  creative: CreativeAsset;
  creativeSha256: string;
  /** Referência do criativo (hash do SVG): o recibo e a auditoria apontam para ela. */
  imageRef: string;
  idempotencyKey: string;
  /**
   * Carrossel como documento (PDF). A API do mLabs pode não suportar documento: capacidade NÃO verificada
   * (ver docs/mlabs-capabilities.md). Aqui só os slides em SVG; a montagem do PDF e o envio ficam para R5-02.
   */
  carousel: { supported: 'unverified'; slides: CarouselSlide[]; skippedFacts: number[]; pdf: null };
  /** Pronto para o SocialPublisher: ainda depende de gates e de imagem aprovada. */
  publishRequest: PublishRequest;
  /** Pendências que bloqueiam a publicação (vazio = nada pendente neste pacote). */
  blockers: string[];
  mock: boolean;
}

export interface LinkedInPackageOptions {
  format?: SocialCardFormat;
  /** `true` só se a API do mLabs confirmou menção em texto (R1-05/R5-02). Padrão: texto puro. */
  mentionsSupported?: boolean;
  version?: number;
  carousel?: boolean;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function buildCarousel(article: SocialCardInput): LinkedInPackage['carousel'] {
  const slides: CarouselSlide[] = [];
  const skipped: number[] = [];
  const add = (kind: CarouselSlide['kind'], headline: string, deck?: string): boolean => {
    try {
      const a = renderSocialCard(article, { format: 'square', headline, deck: deck ?? '' });
      slides.push({ index: slides.length + 1, kind, svg: a.svg });
      return true;
    } catch (e) {
      if (e instanceof CreativeRefusal) return false;
      throw e;
    }
  };
  add('capa', article.title, article.deck);
  article.facts.slice(0, 5).forEach((f, i) => {
    if (!add('fato', f.text)) skipped.push(i);
  });
  add('fechamento', 'Leia a matéria completa no portal Loyalty News');
  return { supported: 'unverified', slides, skippedFacts: skipped, pdf: null };
}

/** Pacote LinkedIn de uma matéria: copy validada + criativo + (opcional) carrossel + pedido de publicação. */
export function buildLinkedInPackage(article: SocialCardInput, opts: LinkedInPackageOptions = {}): LinkedInPackage {
  const copy = generateLinkedInCopy(article); // lança CopyRefusal se violar regra
  const creative = renderSocialCard(article, { format: opts.format ?? 'linkedin_landscape' });
  const creativeSha256 = sha256(creative.svg);
  const imageRef = `creative://${article.id}/${creativeSha256.slice(0, 16)}`;
  const idempotencyKey = `${article.id}:linkedin:v${opts.version ?? 1}`;

  const blockers: string[] = [];
  if (!article.gatesPassed) blockers.push('gates_automaticos_pendentes');
  if (!article.approvedImage) blockers.push('sem_imagem_aprovada');
  if (article.mock) blockers.push('mock_nao_publicavel');
  if (creative.brandStatus !== 'approved') blockers.push(`brandkit_${creative.brandStatus}`);

  return {
    articleId: article.id,
    channel: 'linkedin',
    copy,
    creative,
    creativeSha256,
    imageRef,
    idempotencyKey,
    carousel: opts.carousel === false ? { supported: 'unverified', slides: [], skippedFacts: [], pdf: null } : buildCarousel(article),
    publishRequest: {
      article,
      channel: 'linkedin',
      text: copy.text,
      mentions: copy.mentions,
      idempotencyKey,
      imageRef,
      mentionsSupported: opts.mentionsSupported ?? false,
    },
    blockers,
    mock: Boolean(article.mock),
  };
}
