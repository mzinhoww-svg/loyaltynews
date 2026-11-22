import { healthPayload } from '../../../lib/health';

// Rota de saúde. Demais rotas de API: Frente 02 (LN Backend Engineer).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(healthPayload(process.env));
}
