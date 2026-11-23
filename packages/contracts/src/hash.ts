// Servidor apenas (node:crypto). Subpath `@ln/contracts/hash`. ADR-017, decisão 3.
import { createHash } from 'node:crypto';
import { canonicalPublishedContent, type PublishableContent } from './published-content';

/** sha256 (hex) do conteúdo publicado: fonte única para recibo, outbox e registro de publicação. */
export function publishedContentSha256(c: PublishableContent): string {
  return createHash('sha256').update(canonicalPublishedContent(c), 'utf8').digest('hex');
}
