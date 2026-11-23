// Sessão do LN Studio: sempre a sessão REAL de @ln/auth (Better Auth: cookie + MFA + papel). Não há sessão simulada
// no código do Studio. Os testes e2e entram por um login real contra um backend em PGlite que só existe no build de e2e
// (lib/studio/e2e-backend.e2e.mock.ts, alias em next.config.ts).
import { getSession, type Session } from '@ln/auth';

export async function resolveStudioSession(headers: Headers): Promise<{ session: Session | null }> {
  const session = await getSession(new Request('http://studio.local/', { headers }));
  return { session };
}
