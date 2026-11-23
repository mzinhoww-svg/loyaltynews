import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isEnabled } from '@ln/contracts';
import { findModule } from '@/lib/studio/modules';
import { periodo30 } from '@/lib/studio/comercial';
import { hojeSP } from '@/lib/studio/datas';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { criarCampanhaAction } from './actions';

export const metadata: Metadata = { title: 'Campanhas' };
export const dynamic = 'force-dynamic';

const ESTADOS = ['draft', 'reserved', 'approved', 'active', 'paused', 'completed', 'cancelled'] as const;

type Painel = { campaignsByStatus: Record<string, number>; attention: { kind: string; ref: string; message: string }[]; sellingEnabled: boolean };
type Coluna = { stage: string; items: { accountId: string; accountName: string | null }[] };
type Formato = { id: string; name: string; status: string };

export default async function CampanhasPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; id?: string }> }) {
  await requireModule(findModule('campanhas')!);
  const { tipo, aviso, id } = await searchParams;
  if (id?.trim()) redirect(`/studio/campanhas/${encodeURIComponent(id.trim())}`);
  const { from, to } = periodo30(hojeSP());
  const painelRes = await api.comercial.painel(from, to);
  if (naoConfigurado(painelRes)) {
    return (
      <>
        <h1>Campanhas</h1>
        <SemBanco modulo="O módulo de campanhas" />
      </>
    );
  }
  if (ehErro(painelRes)) {
    return (
      <>
        <h1>Campanhas</h1>
        <div className="st-alert err" role="alert">
          {mensagemErro(painelRes)}
        </div>
      </>
    );
  }
  const painel = painelRes.body as unknown as Painel;
  const quadro = await api.comercial.oportunidades();
  const contasMap = new Map<string, string>();
  for (const col of (ehErro(quadro) ? [] : quadro.body) as unknown as Coluna[]) for (const o of col.items) contasMap.set(o.accountId, o.accountName ?? o.accountId);
  const contas = [...contasMap.entries()];
  const fmt = await api.comercial.formatos();
  const formatos = (ehErro(fmt) ? [] : (fmt.body as unknown as { formats: Formato[] }).formats).filter((f) => f.status !== 'indisponivel');
  const total = Object.values(painel.campaignsByStatus).reduce((a, b) => a + b, 0);
  const vendas = isEnabled('adServerVendas');
  return (
    <>
      <h1>Campanhas</h1>
      <p>Flights, criativos e entrega. Os 7 estados do blueprint: {ESTADOS.join(' → ')}. Ativar exige reserva confirmada e criativo aprovado; sem venda habilitada a campanha não ativa.</p>
      <div className="st-alert" role="status">
        Venda no ad server: <strong>{vendas ? 'ligada' : 'desligada'}</strong> (flag adServerVendas).
      </div>
      <Flash tipo={tipo} aviso={aviso} />

      <h2>Campanhas por estado ({total})</h2>
      <ul aria-label="Campanhas por estado">
        {ESTADOS.map((e) => (
          <li key={e} data-estado={e}>
            {e}: {painel.campaignsByStatus[e] ?? 0}
          </li>
        ))}
      </ul>
      {total === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhuma campanha</h2>
          <p>Nenhuma campanha criada. Campanhas nascem de uma conta do CRM (lead convertido) e de um formato do catálogo.</p>
        </section>
      ) : (
        <p className="st-hint">A API ainda não tem listagem de campanhas: abra uma campanha pelo ID (mostrado ao criar) ou pela busca abaixo.</p>
      )}
      {painel.attention.length > 0 ? (
        <ul aria-label="Pontos de atenção">
          {painel.attention.map((a) => (
            <li key={a.kind + a.ref}>{a.message}</li>
          ))}
        </ul>
      ) : null}
      <form className="st-filters" method="get" role="search" aria-label="Abrir campanha por ID">
        <div className="st-field">
          <label htmlFor="id">ID da campanha</label>
          <input id="id" name="id" type="text" />
        </div>
        <button className="st-btn sec" type="submit">
          Abrir
        </button>
      </form>

      <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="nova">
        <h2 id="nova" style={{ marginTop: 0 }}>
          Nova campanha
        </h2>
        {contas.length === 0 ? (
          <p className="st-hint">Sem contas no CRM: converta um lead qualificado para criar a conta do anunciante.</p>
        ) : (
          <form action={criarCampanhaAction}>
            <div className="st-field">
              <label htmlFor="nome">Nome</label>
              <input id="nome" name="nome" type="text" />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="conta">Anunciante (conta)</label>
                <select id="conta" name="conta">
                  {contas.map(([cid, nome]) => (
                    <option key={cid} value={cid}>
                      {nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="formato">Formato</label>
                <select id="formato" name="formato">
                  {formatos.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="inicio">Início (AAAA-MM-DD)</label>
                <input id="inicio" name="inicio" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="fim">Fim (AAAA-MM-DD)</label>
                <input id="fim" name="fim" type="text" />
              </div>
            </div>
            <div className="st-field">
              <label>
                <input type="checkbox" name="rotulo" /> Conteúdo patrocinado rotulado
              </label>
            </div>
            <button className="st-btn" type="submit">
              Criar campanha
            </button>
          </form>
        )}
      </section>
    </>
  );
}
