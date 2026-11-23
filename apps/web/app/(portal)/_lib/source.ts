import { createApiSlice } from './api-source';
import { emptySource } from './empty-source';
import { resolveSourceKind } from './indexing';
import { mockSource } from './fixtures/portal.mock';
import type { PortalSource } from './types';

let apiSource: PortalSource | undefined;
let warned = false;

/**
 * Ponto único de troca da fonte de dados do portal.
 * Padrão: vazia (estado vazio honesto).
 *  - `PORTAL_SOURCE=mock`: fixtures MOCK (dev, staging e e2e). Com APP_ENV=production só no build de e2e (LN_E2E_BUILD=1);
 *    em produção o pedido de mock é recusado e a fonte vazia é usada (ver resolveSourceKind).
 *  - `PORTAL_SOURCE=api`: matérias vêm das rotas públicas do Backend (`/api/publico/*`). `PORTAL_API_BASE_URL`
 *    aponta para a API (padrão: o próprio servidor, http://127.0.0.1:$PORT). Agenda, Intelligence e audiência seguem
 *    vazias até seus adaptadores.
 */
export function getSource(): PortalSource {
  const { kind, refusedMock } = resolveSourceKind();
  if (refusedMock && !warned) {
    warned = true;
    console.error('[portal] PORTAL_SOURCE=mock recusado com APP_ENV=production (fora do build de e2e): usando a fonte vazia.');
  }
  switch (kind) {
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
