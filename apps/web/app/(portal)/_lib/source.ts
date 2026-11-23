import { createApiSlice } from './api-source';
import { emptySource } from './empty-source';
import { mockSource } from './fixtures/portal.mock';
import type { PortalSource } from './types';

let apiSource: PortalSource | undefined;

/**
 * Ponto único de troca da fonte de dados do portal.
 * Padrão: vazia (estado vazio honesto).
 *  - `PORTAL_SOURCE=mock`: fixtures MOCK (dev/teste).
 *  - `PORTAL_SOURCE=api`: matérias vêm das rotas públicas do Backend (`/api/publico/*`). `PORTAL_API_BASE_URL`
 *    aponta para a API (padrão: o próprio servidor, http://127.0.0.1:$PORT). Agenda, Intelligence e audiência seguem
 *    vazias até seus adaptadores.
 */
export function getSource(): PortalSource {
  switch (process.env.PORTAL_SOURCE) {
    case 'mock':
      return mockSource;
    case 'api':
      return (apiSource ??= {
        ...emptySource,
        kind: 'api',
        ...createApiSlice(process.env.PORTAL_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`),
      });
    default:
      return emptySource;
  }
}

export function isMockSource(): boolean {
  return getSource().kind === 'mock';
}
