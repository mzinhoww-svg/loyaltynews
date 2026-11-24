import { CACHE_60S, NO_STORE } from '../../../../lib/cache-60s';
import { editoriaName } from '../../_lib/editorias';
import { getSource } from '../../_lib/source';

/**
 * Sugestões da busca do cabeçalho: GET /busca/sugestoes?q=<termo>. Termo aparado, de 2 a 80 caracteres (fora disso 400, nunca corta em silêncio); devolve até
 * 5 MATÉRIAS (título, link, editoria, data; nada de pessoa ou empresa, mesmo com a flag do Intelligence ligada) pela MESMA fonte do portal
 * (api, mock ou vazia), então vale nos três modos. Nunca importa fixtures: só `getSource()`.
 *  - fonte fora do ar: 200 { estado: 'indisponivel', itens: [] } (o cliente mostra o erro, que nunca vira "nada encontrado");
 *  - modo vazio / sem resultado: 200 { estado: 'ok', itens: [] } ("nada encontrado", honesto).
 * Cache: resposta boa `public, s-maxage=60, stale-while-revalidate=30` (decisão do UI/UX com o PM, como as páginas sem pessoas); 400 e indisponível
 * em `no-store` (nunca fixar um erro). Fora dos buscadores (x-robots-tag).
 */
export const dynamic = 'force-dynamic';

const MIN = 2;
const MAX = 80;
const ITENS = 5;
const base = { 'x-robots-tag': 'noindex' } as const;

export async function GET(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < MIN || q.length > MAX) return Response.json({ erro: 'q_invalido' }, { status: 400, headers: { ...base, 'cache-control': NO_STORE } });
  const r = await getSource().search(q, 1);
  if (r.unavailable) return Response.json({ q, total: 0, estado: 'indisponivel', itens: [] }, { headers: { ...base, 'cache-control': NO_STORE } });
  return Response.json(
    {
      q,
      total: r.total,
      estado: 'ok',
      itens: r.items.slice(0, ITENS).map((a) => ({ slug: a.slug, titulo: a.title, editoria: editoriaName(a.editoriaSlug), publicadoEm: a.publishedAt })),
    },
    { headers: { ...base, 'cache-control': CACHE_60S } },
  );
}
