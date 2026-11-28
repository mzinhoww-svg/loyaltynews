// Estado público da coleta (vigia externo). Regra e limites em ../../_lib/status-coleta.ts.
import { getDeps } from '../../_lib/deps';
import { statusDaColeta } from '../../_lib/status-coleta';

export const dynamic = 'force-dynamic';

export async function GET() {
  let deps: ReturnType<typeof getDeps>;
  try {
    deps = getDeps();
  } catch {
    deps = null; // configuração inválida: indisponível, sem dizer por quê
  }
  return statusDaColeta(deps);
}
