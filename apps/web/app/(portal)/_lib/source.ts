import { createApiSlice } from './api-source';
import { emptySource } from './empty-source';
import { resolveSourceKind } from './indexing';
import type { PortalSource } from './types';

let apiSource: PortalSource | undefined;
let mockSource: PortalSource | undefined;
let warned = false;

/**
 * Ponto único de troca da fonte de dados do portal.
 * Padrão: vazia (estado vazio honesto).
 *  - `PORTAL_SOURCE=mock`: fixtures MOCK só em desenvolvimento/teste e no build de e2e; NUNCA em deploy.
 *  - `PORTAL_VITRINE=1` + `APP_ENV=staging`: vitrine de demonstração (decisão do Security). Ver resolveSourceKind.
 *  - `PORTAL_SOURCE=api`: matérias vêm das rotas públicas do Backend (`/api/publico/*`). `PORTAL_API_BASE_URL`
 *    aponta para a API (padrão: o próprio servidor, http://127.0.0.1:$PORT). Agenda, Intelligence e audiência seguem
 *    vazias até seus adaptadores.
 */
/**
 * Fixtures MOCK: só entram no bundle em dev/teste ou no build de vitrine do staging. A condição é escrita por extenso (e não
 * em uma constante exportada) para o bundler eliminar o ramo — e o módulo das fixtures — no build de produção (Security R8).
 */
function loadMock(): PortalSource {
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_PORTAL_DEMO === '1') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- require condicional é o que permite eliminar as fixtures do bundle de produção
    return (mockSource ??= (require('./fixtures/portal.mock') as { mockSource: PortalSource }).mockSource);
  }
  return emptySource;
}

export function getSource(): PortalSource {
  const { kind, refusedMock } = resolveSourceKind();
  if (refusedMock && !warned) {
    warned = true;
    console.error('[portal] fonte de demonstração recusada neste ambiente (mock só em dev/teste; vitrine só com PORTAL_VITRINE=1 e APP_ENV=staging): usando a fonte vazia.');
  }
  switch (kind) {
    case 'mock':
      return loadMock();
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
