// Sessão do LN Studio. Usa @ln/auth (stub do scaffold nega; o Backend entrega a real).
// Este arquivo NÃO contém sessão simulada. O único gancho de teste é o "seam" injetado pelo chamador:
// no build de produção o seam é `null` (test-seam.prod.ts); o código simulado vive em test-seam.e2e.mock.ts
// e só entra no build de e2e por alias em next.config.ts (LN_E2E_BUILD=1). Ver scripts/verify-no-mock.mjs.
import { getSession, type Session } from '@ln/auth';

export type TestSeam = (headers: Headers, env: Record<string, string | undefined>) => Session | null;

export interface ResolvedSession {
  session: Session | null;
  /** true quando a sessão veio do seam de teste (a UI deve exibir MOCK). */
  simulada: boolean;
}

export async function resolveStudioSession(
  headers: Headers,
  seam: TestSeam | null = null,
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedSession> {
  if (seam) {
    const sim = seam(headers, env);
    if (sim) return { session: sim, simulada: true };
  }
  const session = await getSession(new Request('http://studio.local/', { headers }));
  return { session, simulada: false };
}
