import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { checkAccess } from '@/lib/studio/modules';
import { planilhaCsv } from '@/lib/studio/piloto-planilha';
import type { Leitura } from '@/lib/studio/piloto-view';
import { currentSession } from '../../../_lib/guard';

/**
 * Download da planilha do piloto em CSV (Studio 2; PM-2026-11-23-F). Só o leitor 1 (admin ou editor-chefe). Junta as linhas da trilha
 * (Backend 1: GET /api/studio/openbot/piloto/linhas) com o mapa e as leituras da Editorial, que já aplicam a cegueira no servidor;
 * a regra de combinação (leitor 2 só depois do leitor 1) é a de lib/studio/piloto-planilha.ts. Sem sessão 401, sem papel 403, sem corpo de dados.
 */
export const dynamic = 'force-dynamic';

const texto = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export async function GET() {
  const { session } = await currentSession();
  if (!session) return texto(401, 'Sessão necessária.');
  if (!checkAccess(session, ['admin', 'editor_chefe']).ok) return texto(403, 'Só o leitor 1 (admin ou editor-chefe) exporta a planilha do piloto.');
  const [linhas, mapa] = await Promise.all([api.piloto.linhas(), api.piloto.materias()]);
  if (ehErro(linhas)) return texto(linhas.status, mensagemErro(linhas));
  if (ehErro(mapa)) return texto(mapa.status, mensagemErro(mapa));
  const leituras: Record<string, Leitura[]> = {};
  for (const m of mapa.body.items) {
    if (!m.articleId) continue;
    const l = await api.piloto.leituras(m.materia);
    if (ehErro(l)) return texto(l.status, mensagemErro(l));
    leituras[m.materia] = l.body.leituras;
  }
  const csv = planilhaCsv(linhas.body.items, mapa.body.items, leituras);
  const dia = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="piloto-planilha-${dia}.csv"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
