import { createHash } from 'node:crypto';
import type { Source } from '../types';
import type { EditorialStore, SourceState } from '../api/store';
import type { SourceRegistry } from './registry';

/**
 * Habilitação de fonte NUNCA é automática: o cadastro (seed) é imutável e sempre `enabled=false`;
 * o estado efetivo vem de `SourceState`, gravado só pelo handler de revisão/habilitação do Studio.
 */

/** Impressão digital do que o revisor conferiu. Qualquer mudança de host/prefixo/URLs/termos invalida a revisão. */
export function sourceFingerprint(s: Source): string {
  return createHash('sha256').update(JSON.stringify([s.host, s.pathPrefix ?? null, s.listingUrl, s.feedUrl, s.termsUrl])).digest('hex');
}

/** Combina cadastro + estado. Estado sem revisão válida e atual não habilita nada (fail closed). */
export function effectiveSource(s: Source, st: SourceState | undefined): Source {
  // Sem revisão registrada: nada é habilitado, mesmo que o cadastro diga o contrário.
  if (!st || !st.review) return { ...s, enabled: false, termsStatus: 'pending', urlVerified: false };
  const fresh = st.review.fingerprint === sourceFingerprint(s);
  const ok = fresh && st.review.termsStatus === 'approved' && st.review.urlVerified && st.review.robotsChecked;
  return {
    ...s,
    enabled: ok && st.enabled,
    termsStatus: fresh ? st.review.termsStatus : 'pending',
    urlVerified: fresh && st.review.urlVerified,
    paywall: fresh ? st.review.paywall : s.paywall,
  };
}

export async function resolveEffectiveSources(registry: SourceRegistry, store: EditorialStore): Promise<Source[]> {
  const states = new Map((await store.listSourceStates()).map((x) => [x.sourceId, x]));
  return registry.all().map((s) => effectiveSource(s, states.get(s.id)));
}
