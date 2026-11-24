// Troca da própria senha (tela /studio/conta). Regras em @ln/auth changeOwnPassword; envelope em _lib/conta-senha.ts.
import { getRuntime } from '@ln/auth/runtime';
import { apiError } from '@ln/contracts';
import { trocarSenhaHandler } from '../../../_lib/conta-senha';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const rt = getRuntime();
  if (!rt || process.env.APP_MODE === 'nodb') {
    return Response.json(apiError('NOT_CONFIGURED', 'Autenticação não configurada neste ambiente.'), { status: 503 });
  }
  return trocarSenhaHandler(req, { auth: rt.auth, db: rt.db });
}
