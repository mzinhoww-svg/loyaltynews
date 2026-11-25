import type { Metadata } from 'next';
import { dispatchSocial } from '@/app/api/_lib/social';
import { chamar, ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { findModule } from '@/lib/studio/modules';
import { requireModule } from '../../_lib/guard';
import { SemBanco } from '../../_components/SemBanco';
import { Recarregar } from '../../_components/Recarregar';

export const metadata: Metadata = { title: 'Auditoria' };
export const dynamic = 'force-dynamic';

interface Registro {
  ts: string;
  actorId: string;
  actorRole: string;
  action: string;
  channel: string;
  outcome: 'accepted' | 'refused';
  reason?: string;
  articleId?: string;
  receiptId?: string;
}

const LIMITES = ['50', '100', '200'];

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<{ limit?: string }> }) {
  await requireModule(findModule('auditoria')!);
  const { limit = '50' } = await searchParams;
  const n = LIMITES.includes(limit) ? limit : '50';
  const r = await chamar<{ items: Registro[] }>(dispatchSocial, '/api/studio/social/audit', { query: { limit: n } });
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Auditoria</h1>
        <SemBanco modulo="A auditoria" />
      </>
    );
  }
  const itens = ehErro(r) ? [] : r.body.items;
  return (
    <>
      <h1>Auditoria</h1>
      <p>Trilha de ações por identidade. Só o admin lê. Nada aqui é inventado: cada linha vem de uma rota do Backend e as trilhas sem rota aparecem como lacuna.</p>

      <h2>Publicação social (simulada)</h2>
      <p className="st-hint">
        Fonte: <code>GET /api/studio/social/audit</code>. O publicador é simulado (nada vai ao mLabs) e a trilha dele vive na memória do processo do Backend: some ao reiniciar.
      </p>
      <form className="st-filters" method="get" role="search" aria-label="Quantidade de registros">
        <div className="st-field">
          <label htmlFor="limit">Registros</label>
          <select id="limit" name="limit" defaultValue={n}>
            {LIMITES.map((l) => (
              <option key={l} value={l}>
                últimos {l}
              </option>
            ))}
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Aplicar
        </button>
      </form>
      {ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
          <Recarregar />
        </div>
      ) : itens.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h3 id="vazio">Nenhuma ação de auditoria</h3>
          <p>O publicador social ainda não registrou nenhuma tentativa de geração ou publicação neste processo.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {itens.length} registro(s), do mais recente ao mais antigo
          </caption>
          <thead>
            <tr>
              <th scope="col">Quando (UTC)</th>
              <th scope="col">Quem</th>
              <th scope="col">Ação</th>
              <th scope="col">Canal</th>
              <th scope="col">Resultado</th>
              <th scope="col">Matéria</th>
              <th scope="col">Recibo</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((a, i) => (
              <tr key={`${a.ts}-${i}`} data-resultado={a.outcome}>
                <th scope="row">{a.ts.slice(0, 19).replace('T', ' ')}</th>
                <td>
                  {a.actorId} ({a.actorRole})
                </td>
                <td>{a.action}</td>
                <td>{a.channel}</td>
                <td>
                  {a.outcome === 'accepted' ? 'aceita' : 'recusada'}
                  {a.reason ? ` — ${a.reason}` : ''}
                </td>
                <td>{a.articleId ?? '—'}</td>
                <td>{a.receiptId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 24 }}>Outras trilhas</h2>
      <section className="st-card" data-lacuna="trilha-do-banco" aria-label="Trilhas sem rota de leitura">
        <p>
          A trilha do banco (<code>audit_log</code>: CMS, publicação oficial, correções, login) é gravada pelo Backend, mas ainda <strong>não tem rota de leitura</strong>; por isso não há tela para ela. Trust (fact check, licenças, LGPD) e integrações com credenciais mascaradas também aguardam rota.
        </p>
        <p className="st-hint">Quando a rota existir, estas linhas passam a vir dela. Até lá, esta tela não simula registros.</p>
      </section>
    </>
  );
}
