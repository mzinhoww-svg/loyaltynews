import { healthPayload, healthProblem } from '../../../lib/health';
import { readBuildIdentity } from '../../../lib/build-identity';
import { diagXffHeaders } from '../_lib/diag-xff';
import { runtimeFlagNames } from '../../../lib/runtime-flags';

// Rota de saúde. Demais rotas de API: Frente 02 (LN Backend Engineer).
// Corpo e status são os de sempre; só com DIAG_XFF=1 (fora de produção) acrescenta x-ln-xff-count (e, com CF-Connecting-IP, x-ln-xff-match e x-ln-xff-match-pos).
// ADR-022: com flags inválidas (ex.: produção com flag sem decisão) o processo é derrubado no register(); se alguma requisição chegar antes
// do exit, o health responde 503 e NUNCA 200 (achado do QA 8 em 26be6bb). A mensagem cita só nome e ambiente, como o resolveFlags.
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  let flags: string[];
  try {
    flags = runtimeFlagNames();
  } catch {
    return Response.json({ status: 'indisponivel', motivo: 'flags_invalidas' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const identity = readBuildIdentity();
  const problema = healthProblem(process.env, identity);
  if (problema) return Response.json({ status: 'indisponivel', motivo: problema }, { status: 503, headers: { 'cache-control': 'no-store' } });
  return Response.json(healthPayload(process.env, flags, identity), { headers: diagXffHeaders(process.env, req.headers) });
}
