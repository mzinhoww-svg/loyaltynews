import { api } from '@/lib/studio/rotas-api';

/**
 * Download do relatório do anunciante em CSV (diário ou resumo). A autenticação, o RBAC e a validação da janela são da API comercial
 * (a mesma rota que o Studio usa em processo, com o cookie da sessão): sem sessão ou sem permissão a resposta é 401/403, sem corpo de dados.
 */
export const dynamic = 'force-dynamic';

const texto = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await ctx.params).id);
  const url = new URL(req.url);
  const tipo = url.searchParams.get('tipo') === 'resumo' ? 'resumo' : 'diario';
  const r = await api.comercial.relatorioCsv(id, tipo, url.searchParams.get('de') ?? undefined, url.searchParams.get('ate') ?? undefined);
  if (!r.ok) return texto(r.status, r.body?.error?.message ?? `Erro ${r.status}`);
  const { filename, contentType, csv } = r.body as { filename: string; contentType: string; csv: string };
  // filename vem do domínio já saneado (a-z, 0-9, hífen e ponto); mesmo assim só aceita esse alfabeto.
  const safe = /^[a-z0-9.-]{1,120}$/.test(filename) ? filename : 'relatorio.csv';
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${safe}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
