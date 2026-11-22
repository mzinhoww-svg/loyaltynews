import { emptySource } from './empty-source';
import { mockSource } from './fixtures/portal.mock';
import type { PortalSource } from './types';

/**
 * Ponto único de troca da fonte de dados do portal.
 * Padrão: vazia (estado vazio honesto). `PORTAL_SOURCE=mock` habilita fixtures MOCK (dev/teste).
 * TODO(api): `PORTAL_SOURCE=api` quando a API do Backend (apps/web/app/api) publicar os endpoints de leitura.
 */
export function getSource(): PortalSource {
  return process.env.PORTAL_SOURCE === 'mock' ? mockSource : emptySource;
}

export function isMockSource(): boolean {
  return getSource().kind === 'mock';
}
