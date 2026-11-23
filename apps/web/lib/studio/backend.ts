// Cliente EM PROCESSO das rotas reais do Backend (apps/web/app/api): o Studio chama o mesmo despachante que as rotas HTTP
// usam, repassando o cookie da sessão real do usuário. Assim autenticação (Better Auth + MFA), RBAC, transações,
// auditoria e erros são exatamente os da API. Sem DATABASE_URL a API responde 503 NOT_CONFIGURED e as telas mostram
// "banco não configurado" (nunca dados falsos). Só para Server Components e server actions.
import { headers } from 'next/headers';

export type RespostaApi<T = unknown> = { status: number; ok: true; body: T } | { status: number; ok: false; body: ErroApi };

export type Despachante = (req: Request) => Promise<Response>;

export interface ErroApi {
  error: { code: string; message: string; details?: unknown };
}

export async function chamar<T = unknown>(
  despachar: Despachante,
  caminho: string,
  opts: { metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; query?: Record<string, string | undefined>; corpo?: unknown; form?: FormData } = {},
): Promise<RespostaApi<T>> {
  const url = new URL(caminho, 'http://studio.local');
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);
  const cookie = (await headers()).get('cookie');
  const metodo = opts.metodo ?? 'GET';
  const req = new Request(url, {
    method: metodo,
    // multipart: o content-type (com boundary) é definido pelo próprio Request ao receber o FormData
    headers: { ...(opts.form ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    ...(opts.form ? { body: opts.form } : opts.corpo !== undefined && metodo !== 'GET' ? { body: JSON.stringify(opts.corpo) } : {}),
  });
  const res = await despachar(req);
  const body = await res.json().catch(() => null);
  return (res.status >= 400 ? { status: res.status, ok: false, body: body ?? { error: { code: 'UNKNOWN', message: `Erro ${res.status}` } } } : { status: res.status, ok: true, body }) as RespostaApi<T>;
}

export const ehErro = <T>(r: RespostaApi<T>): r is Extract<RespostaApi<T>, { ok: false }> => !r.ok;

/** Banco/Backend não configurado neste ambiente (503 NOT_CONFIGURED). */
export const naoConfigurado = (r: RespostaApi<unknown>): boolean => r.status === 503 && (r.body as ErroApi | null)?.error?.code === 'NOT_CONFIGURED';

/** Mensagem legível do envelope de erro, com detalhes de validação quando houver. */
export function mensagemErro(r: RespostaApi<unknown>): string {
  const e = (r.body as ErroApi | null)?.error;
  if (!e) return `Erro ${r.status}`;
  const det = Array.isArray(e.details) ? ' ' + (e.details as { path?: string; message?: string }[]).map((d) => `${d.path ? d.path + ': ' : ''}${d.message ?? ''}`).join('; ') : '';
  return `${e.message}${det}`;
}
