import { POSITIONS } from '@ln/commercial';
import { TabelaRolavel, TABELA_NO_CONTEINER } from '../../../../_components/TabelaRolavel';
import { adicionarCriativoAction, definirPosicoesAction, aprovarCriativoAction, cancelarReservaAction, enviarArquivoCriativoAction, reservarPosicaoAction } from '../../actions';

export type ReservaLinha = { id: string; positionId: string; startDate: string; endDate: string; status: string };
export type CriativoLinha = {
  id: string;
  positionId: string;
  startDate: string;
  endDate: string;
  approved: boolean;
  altText?: string;
  advertiserName?: string;
  destinationUrl?: string;
  asset?: { mime: string; width: number; height: number; sizeKB: number; sha256: string };
};

const ESTADO_RESERVA: Record<string, string> = { held: 'pré-reserva', confirmed: 'confirmada', cancelled: 'cancelada' };
// só posições com dimensões e limite configurados são reserváveis (as demais o domínio recusa)
const RESERVAVEIS = POSITIONS.filter((p) => p.slotLimit !== null && p.desktop !== null);
const GRADE = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 } as const;

/**
 * Posições (reservas) e criativos da campanha. Tudo vem do detalhe do Backend; nada é calculado aqui.
 * As regras (período, dimensão, peso, venda ligada, criativo real) são do domínio: as recusas voltam no aviso da página.
 */
export function PosicoesCriativos(props: {
  campanha: { id: string; accountId: string; startDate: string; endDate: string; status: string; positionId?: string | null; positionIds?: string[] };
  reservas: ReservaLinha[];
  criativos: CriativoLinha[];
  vendaLigada: boolean;
}) {
  const { campanha: c, reservas, criativos, vendaLigada } = props;
  const escreve = c.status !== 'completed' && c.status !== 'cancelled';
  const declaradas = c.positionIds ?? [];
  // reserva e criativo só nas posições da campanha (regra do domínio); sem posição declarada, o formulário não aparece
  const DA_CAMPANHA = RESERVAVEIS.filter((p) => declaradas.includes(p.id));
  const posPadrao = DA_CAMPANHA[0]?.id;
  return (
    <>
      <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="h-posicoes" data-testid="posicoes">
        <h2 id="h-posicoes" style={{ marginTop: 0 }}>
          Posições
        </h2>
        <form action={definirPosicoesAction} aria-label="Posições da campanha" data-testid="posicoes-campanha" style={{ marginBottom: 12 }}>
          <input type="hidden" name="id" value={c.id} />
          <fieldset disabled={c.status !== 'draft'}>
            <legend>Posições da campanha</legend>
            {RESERVAVEIS.map((p) => (
              <label key={p.id} style={{ marginRight: 12, display: 'inline-block' }}>
                <input type="checkbox" name="posicoes" value={p.id} defaultChecked={declaradas.includes(p.id)} /> {p.id}
              </label>
            ))}
          </fieldset>
          {c.status === 'draft' ? (
            <button className="st-btn sec" type="submit" style={{ marginTop: 8 }}>
              Salvar posições
            </button>
          ) : (
            <p className="st-hint">As posições só mudam em rascunho.</p>
          )}
          {declaradas.length === 0 ? <p data-vazio="posicoes-campanha">Nenhuma posição definida: defina ao menos uma para reservar e criar criativos.</p> : null}
        </form>
        {reservas.length === 0 ? (
          <p data-vazio="posicoes">Nenhuma posição reservada. Para mover a campanha para “reserved”, reserve ao menos uma posição.</p>
        ) : (
          <TabelaRolavel rotulo="Reservas da campanha">
<table className="st-table" style={TABELA_NO_CONTEINER} aria-label="Reservas da campanha">
            <thead>
              <tr>
                <th scope="col">Posição</th>
                <th scope="col">Período</th>
                <th scope="col">Estado</th>
                {escreve ? <th scope="col">Ação</th> : null}
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={r.id} data-reserva={r.id} data-status={r.status}>
                  <td>{r.positionId}</td>
                  <td>
                    {r.startDate} → {r.endDate}
                  </td>
                  <td>{ESTADO_RESERVA[r.status] ?? r.status}</td>
                  {escreve ? (
                    <td>
                      {r.status !== 'cancelled' ? (
                        <form action={cancelarReservaAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="reserva" value={r.id} />
                          <button className="st-btn danger" type="submit" aria-label={`Cancelar reserva ${r.positionId} de ${r.startDate}`}>
                            Cancelar
                          </button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
</TabelaRolavel>
        )}
        {escreve && DA_CAMPANHA.length > 0 ? (
          <form action={reservarPosicaoAction} aria-label="Reservar posição" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="conta" value={c.accountId} />
            <div style={GRADE}>
              <div className="st-field">
                <label htmlFor="res-posicao">Posição</label>
                <select id="res-posicao" name="posicao" defaultValue={posPadrao}>
                  {DA_CAMPANHA.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.name} ({p.desktop})
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="res-inicio">Início da reserva (obrigatório)</label>
                <input id="res-inicio" name="inicio" type="date" required defaultValue={c.startDate} />
              </div>
              <div className="st-field">
                <label htmlFor="res-fim">Fim da reserva (obrigatório)</label>
                <input id="res-fim" name="fim" type="date" required defaultValue={c.endDate} />
              </div>
            </div>
            <p>
              <label>
                <input type="checkbox" name="confirmar" disabled={!vendaLigada} /> Confirmar venda
              </label>{' '}
              {vendaLigada ? null : <span className="st-hint">(venda no ad server desligada: fica como pré-reserva)</span>}
            </p>
            <div className="st-actions">
              <button className="st-btn" type="submit">
                Reservar posição
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="st-card" style={{ marginTop: 14 }} aria-labelledby="h-criativos" data-testid="criativos">
        <h2 id="h-criativos" style={{ marginTop: 0 }}>
          Criativos
        </h2>
        <p className="st-hint">
          Só criativo aprovado entra no ar. Aprovar exige arquivo na dimensão e no peso da posição (medidos no servidor), texto alternativo, anunciante e destino https. Trocar o
          arquivo revoga a aprovação.
        </p>
        {criativos.length === 0 ? (
          <p data-vazio="criativos">Nenhum criativo cadastrado.</p>
        ) : (
          <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
            {criativos.map((cr) => (
              <li key={cr.id} data-criativo={cr.id} data-aprovado={cr.approved ? 'sim' : 'nao'} style={{ marginBottom: 14 }}>
                <strong>{cr.id}</strong> · {cr.positionId} · {cr.startDate} → {cr.endDate} · <span className="st-badge">{cr.approved ? 'aprovado' : 'não aprovado'}</span>
                <div className="st-hint">
                  Arquivo:{' '}
                  {cr.asset ? `${cr.asset.mime}, ${cr.asset.width}x${cr.asset.height}, ${cr.asset.sizeKB} KB, sha256 ${cr.asset.sha256.slice(0, 12)}…` : 'nenhum'} · Alt:{' '}
                  {cr.altText || '—'} · Anunciante: {cr.advertiserName || '—'} · Destino: {cr.destinationUrl || '—'}
                </div>
                {escreve ? (
                  <div className="st-actions" style={{ marginTop: 6 }}>
                    <form action={enviarArquivoCriativoAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="criativo" value={cr.id} />
                      <label>
                        Arquivo de {cr.id} <input type="file" name="arquivo" accept="image/jpeg,image/png,image/gif" />
                      </label>{' '}
                      <button className="st-btn sec" type="submit">
                        Enviar arquivo de {cr.id}
                      </button>
                    </form>
                    {!cr.approved ? (
                      <form action={aprovarCriativoAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="criativo" value={cr.id} />
                        <button className="st-btn" type="submit">
                          Aprovar {cr.id}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {escreve && DA_CAMPANHA.length > 0 ? (
          <form action={adicionarCriativoAction} aria-label="Adicionar criativo" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={c.id} />
            <div style={GRADE}>
              <div className="st-field">
                <label htmlFor="cr-posicao">Posição do criativo</label>
                <select id="cr-posicao" name="posicao" defaultValue={posPadrao}>
                  {DA_CAMPANHA.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} ({p.desktop}, até {p.maxWeightKB} KB)
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="cr-inicio">Início do criativo (obrigatório)</label>
                <input id="cr-inicio" name="inicio" type="date" required defaultValue={c.startDate} />
              </div>
              <div className="st-field">
                <label htmlFor="cr-fim">Fim do criativo (obrigatório)</label>
                <input id="cr-fim" name="fim" type="date" required defaultValue={c.endDate} />
              </div>
              <div className="st-field">
                <label htmlFor="cr-alt">Texto alternativo (obrigatório para aprovar)</label>
                <input id="cr-alt" name="alt" type="text" maxLength={200} />
              </div>
              <div className="st-field">
                <label htmlFor="cr-destino">Destino (https, obrigatório para aprovar)</label>
                <input id="cr-destino" name="destino" type="text" inputMode="url" maxLength={2000} />
              </div>
              <div className="st-field">
                <label htmlFor="cr-anunciante">Anunciante exibido</label>
                <input id="cr-anunciante" name="anunciante" type="text" maxLength={80} />
              </div>
            </div>
            <div className="st-actions" style={{ marginTop: 8 }}>
              <button className="st-btn" type="submit">
                Adicionar criativo
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}
