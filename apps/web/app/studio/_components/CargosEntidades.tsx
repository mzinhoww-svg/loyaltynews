import Link from 'next/link';
import { QuadroRolavel } from './QuadroRolavel';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { FILTROS_DE_NIVEL, nivelPorFonte, textoDaEvidencia, type CargoDaLista, type NivelDaFonte } from '@/lib/studio/intelligence-view';
import { confirmarCargoAction, descartarCargoAction } from '../(protegido)/entidades/actions';

const BADGE: Record<'oficial' | 'secundaria' | 'inferida', string> = { oficial: 'aprovado', secundaria: 'em_checagem', inferida: 'em_checagem' };

function Fonte({ c }: { c: CargoDaLista }) {
  return (
    <>
      <a href={c.evidence.source_url} rel="noreferrer noopener">
        {textoDaEvidencia(c.evidence)}
      </a>
      <div className="st-hint">validado em {c.validated_at.slice(0, 10)}</div>
    </>
  );
}

/**
 * Fila "a confirmar": cargos lidos de LinkedIn ou de site de organograma (fonte secundária) entram como INFERIDOS e nunca valem como fato.
 * O editor confirma com a página OFICIAL (o servidor confere o site, não lê a página) ou descarta com motivo. Confirmar não cria Move.
 * `organizationId` restringe à empresa.
 */
export async function CargosAConfirmar({ organizationId, podeAgir, retorno }: { organizationId?: string; podeAgir: boolean; retorno: string }) {
  const r = await api.intelligence.cargos({ certainty: 'inferred', limit: 50, ...(organizationId ? { organizationId } : {}) });
  return (
    <section aria-labelledby="a-confirmar" style={{ marginTop: 24 }} data-secao="a-confirmar">
      <h2 id="a-confirmar">Cargos a confirmar{!ehErro(r) && r.body.total ? ` (${r.body.total})` : ''}</h2>
      <p className="st-hint">
        Vindo de LinkedIn ou de site de organograma: <strong>fonte secundária, nunca fato</strong>. Não vira Move, não fecha cargo e não aparece no portal. Confirme com a página oficial da empresa ou descarte.
      </p>
      {ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : r.body.items.length === 0 ? (
        <p className="st-hint" data-vazio="a-confirmar">
          Nenhum cargo aguardando confirmação.
        </p>
      ) : (
        <ul className="st-issues" aria-label="Cargos a confirmar">
          {r.body.items.map((c) => {
            const nivel = nivelPorFonte(c.source_level);
            return (
              <li key={c.role_id} data-a-confirmar={c.title} data-cargo-id={c.role_id} data-nivel={nivel.chave}>
                <p style={{ margin: '4px 0' }}>
                  <strong>{c.person_name}</strong> — {c.title} · <Link href={`/studio/entidades/${c.organization_id}`}>{c.organization}</Link>{' '}
                  <span className={`st-badge ${BADGE[nivel.chave]}`}>{nivel.rotulo}</span>
                </p>
                <p className="st-hint" style={{ margin: 0 }}>
                  Fonte secundária: <Fonte c={c} />
                </p>
                {podeAgir ? (
                  <div className="st-row" style={{ marginTop: 8 }}>
                    <form action={confirmarCargoAction} aria-label={`Confirmar cargo de ${c.person_name}`}>
                      <input type="hidden" name="id" value={c.role_id} />
                      <input type="hidden" name="retorno" value={retorno} />
                      <div className="st-field">
                        <label htmlFor={`oficial-${c.role_id}`}>Página oficial que sustenta o cargo de {c.person_name} (https)</label>
                        <input id={`oficial-${c.role_id}`} name="officialUrl" type="text" placeholder="https://…" />
                      </div>
                      <button className="st-btn" type="submit">
                        Confirmar com a página oficial
                      </button>
                    </form>
                    <form action={descartarCargoAction} aria-label={`Descartar cargo de ${c.person_name}`}>
                      <input type="hidden" name="id" value={c.role_id} />
                      <input type="hidden" name="retorno" value={retorno} />
                      <div className="st-field">
                        <label htmlFor={`motivo-${c.role_id}`}>Motivo do descarte de {c.person_name} (5 a 200 caracteres)</label>
                        <input id={`motivo-${c.role_id}`} name="motivo" type="text" />
                      </div>
                      <button className="st-btn danger" type="submit">
                        Descartar
                      </button>
                    </form>
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

const POR_PAGINA = 20;

/** Cargos abertos com o nível da fonte (oficial ou secundária), filtro e paginação; vem da rota GET /roles do Backend. */
export async function CargosLista({ nivel, q, pagina, base }: { nivel: '' | NivelDaFonte; q: string; pagina: number; base: string }) {
  const r = await api.intelligence.cargos({ ...(nivel ? { source_level: nivel } : {}), ...(q ? { q } : {}), limit: POR_PAGINA, offset: (pagina - 1) * POR_PAGINA });
  const qs = (n: number) => `${base}?${new URLSearchParams({ ...(nivel ? { nivel } : {}), ...(q ? { cq: q } : {}), pagina: String(n) }).toString()}#cargos`;
  return (
    <section aria-labelledby="cargos" style={{ marginTop: 24 }} data-secao="cargos" id="cargos">
      <h2 id="cargos">Cargos</h2>
      <form className="st-filters" method="get" role="search" aria-label="Filtrar cargos">
        <div className="st-field">
          <label htmlFor="nivel">Nível da fonte</label>
          <select id="nivel" name="nivel" defaultValue={nivel}>
            {FILTROS_DE_NIVEL.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="st-field">
          <label htmlFor="cq">Pessoa, cargo ou empresa</label>
          <input id="cq" name="cq" type="search" defaultValue={q} />
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar cargos
        </button>
      </form>
      {ehErro(r) ? (
        <div className="st-alert err" role="alert">
          {mensagemErro(r)}
        </div>
      ) : r.body.items.length === 0 ? (
        <p className="st-hint" data-vazio="cargos">
          Nenhum cargo com esses filtros.
        </p>
      ) : (
        <>
          <QuadroRolavel rotulo="Cargos e relações">
<table className="st-table" aria-label="Cargos">
            <caption className="st-hint" style={{ textAlign: 'left' }}>
              {r.body.total} cargo(s) aberto(s) · página {pagina} de {Math.max(1, Math.ceil(r.body.total / POR_PAGINA))}
            </caption>
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                <th scope="col">Cargo</th>
                <th scope="col">Empresa</th>
                <th scope="col">Nível</th>
                <th scope="col">Fonte e data</th>
              </tr>
            </thead>
            <tbody>
              {r.body.items.map((c) => {
                const n = nivelPorFonte(c.source_level);
                return (
                  <tr key={c.role_id} data-cargo={c.title} data-nivel={n.chave} data-status={c.status}>
                    <th scope="row">
                      <Link href={`/studio/entidades/pessoa/${c.person_id}`}>{c.person_name}</Link>
                    </th>
                    <td>{c.title}</td>
                    <td>
                      <Link href={`/studio/entidades/${c.organization_id}`}>{c.organization}</Link>
                    </td>
                    <td>
                      <span className={`st-badge ${BADGE[n.chave]}`}>{n.rotulo}</span>
                    </td>
                    <td>
                      <Fonte c={c} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
</QuadroRolavel>
          {r.body.total > POR_PAGINA ? (
            <nav aria-label="Paginação de cargos" className="st-actions">
              {pagina > 1 ? <Link className="st-btn sec" href={qs(pagina - 1)}>Anterior</Link> : null}
              {pagina * POR_PAGINA < r.body.total ? <Link className="st-btn sec" href={qs(pagina + 1)}>Próxima</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
