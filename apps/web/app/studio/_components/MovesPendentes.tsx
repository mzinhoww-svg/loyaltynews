import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { ROTULO_BASE, ROTULO_MOVE, antesEDepois, textoDaEvidencia, type LadoDoMove } from '@/lib/studio/intelligence-view';
import { revisarMoveAction } from '../(protegido)/entidades/actions';

function Lado({ lado }: { lado: LadoDoMove }) {
  return (
    <div data-lado={lado.rotulo.toLowerCase()}>
      <strong>{lado.rotulo}</strong>
      {lado.cargo ? (
        <>
          <div>
            {lado.cargo.titulo} · {lado.cargo.organizacao}
          </div>
          {lado.evidencia ? (
            <div className="st-hint">
              Fonte: <a href={lado.evidencia.source_url} rel="noreferrer noopener">{textoDaEvidencia(lado.evidencia)}</a>
              {lado.validadoEm ? ` · validado em ${lado.validadoEm.slice(0, 10)}` : ''}
            </div>
          ) : (
            <div className="st-hint">Sem leitura anterior com fonte nesta resposta.</div>
          )}
        </>
      ) : (
        <div className="st-hint">{lado.rotulo === 'Antes' ? 'Não havia cargo anterior registrado.' : 'Sem cargo depois (saída).'}</div>
      )}
    </div>
  );
}

/**
 * Moves que aguardam revisão (estado "detected") com as DUAS leituras, antes e depois, cada uma com fonte, link e data. Nunca o trecho da página.
 * Revisar é do editor ou superior e passa pela rota do Backend (POST /moves/:id/review); o portal só vê o que for confirmado.
 * `organizationId` restringe aos Moves que tocam a empresa.
 */
export async function MovesPendentes({ organizationId, podeRevisar, retorno }: { organizationId?: string; podeRevisar: boolean; retorno: string }) {
  const r = await api.intelligence.moves({ status: 'detected', ...(organizationId ? { organizationId } : {}) });
  if (ehErro(r)) {
    return (
      <section aria-labelledby="fila-moves" style={{ marginTop: 24 }}>
        <h2 id="fila-moves">Moves pendentes de revisão</h2>
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      </section>
    );
  }
  const moves = r.body.items;
  return (
    <section aria-labelledby="fila-moves" style={{ marginTop: 24 }}>
      <h2 id="fila-moves">Moves pendentes de revisão{moves.length ? ` (${moves.length})` : ''}</h2>
      {moves.length === 0 ? (
        <p className="st-hint" data-vazio="moves">
          Nenhuma movimentação aguardando revisão.
        </p>
      ) : (
        <ul className="st-issues" aria-label="Moves pendentes">
          {moves.map((m) => {
            const [antes, depois] = antesEDepois(m);
            return (
              <li key={m.id} data-move={m.id} data-kind={m.kind}>
                <p style={{ margin: '4px 0' }}>
                  <strong>{m.person_name}</strong> — {ROTULO_MOVE[m.kind]} <span className="st-hint">({ROTULO_BASE[m.basis]})</span>
                </p>
                <p className="st-hint" style={{ margin: 0 }}>
                  Lido em {m.observed_on}
                  {m.effective_date ? ` · efetiva em ${m.effective_date}` : ' · data efetiva não informada pela fonte'}
                </p>
                <div className="st-row" style={{ marginTop: 8 }}>
                  <Lado lado={antes} />
                  <Lado lado={depois} />
                </div>
                {podeRevisar ? (
                  <div className="st-actions" style={{ marginTop: 8 }}>
                    {(['confirmed', 'rejected'] as const).map((s) => (
                      <form action={revisarMoveAction} key={s}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="status" value={s} />
                        <input type="hidden" name="retorno" value={retorno} />
                        <button className={s === 'rejected' ? 'st-btn danger' : 'st-btn'} type="submit" aria-label={`${s === 'confirmed' ? 'Confirmar' : 'Rejeitar'} ${m.person_name}`}>
                          {s === 'confirmed' ? 'Confirmar' : 'Rejeitar'}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
