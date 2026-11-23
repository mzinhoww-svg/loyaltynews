import { healthPayload } from '../../../lib/health';
import { diagXffHeaders } from '../_lib/diag-xff';

// Rota de saúde. Demais rotas de API: Frente 02 (LN Backend Engineer).
// Corpo e status são os de sempre; só com DIAG_XFF=1 (fora de produção) acrescenta x-ln-xff-count (e, com CF-Connecting-IP, x-ln-xff-match e x-ln-xff-match-pos).
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return Response.json(healthPayload(process.env), { headers: diagXffHeaders(process.env, req.headers) });
}
