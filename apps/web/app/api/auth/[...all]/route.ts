// Better Auth atrás do envelope de segurança (rotas permitidas, limite de tentativas, auditoria).
import { getRuntime } from '@ln/auth/runtime';
import { apiError } from '@ln/contracts';

export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const rt = getRuntime();
  if (!rt || process.env.APP_MODE === 'nodb') {
    return Response.json(apiError('NOT_CONFIGURED', 'Autenticação não configurada neste ambiente.'), { status: 503 });
  }
  return rt.handle(req);
}

export const GET = handle;
export const POST = handle;
