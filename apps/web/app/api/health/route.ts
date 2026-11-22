import { FLAG_DEFAULTS } from '@ln/contracts';
import { healthPayload } from '../../../lib/health';

// Rota de saúde do scaffold. Demais rotas de API: Frente 02 (LN Backend Engineer).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(healthPayload(FLAG_DEFAULTS));
}
