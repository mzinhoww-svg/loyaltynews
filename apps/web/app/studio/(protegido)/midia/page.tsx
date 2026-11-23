import type { Metadata } from 'next';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { estadoDeUso, getMidia, type EstadoUso } from '@/lib/studio/midia';
import { hojeSP } from '@/lib/studio/agenda';
import { ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireModule } from '../../_lib/guard';
import { Flash, SemBackend } from '../../_components/Flash';
import { registrarMidiaAction, removerMidiaAction } from './actions';

export const metadata: Metadata = { title: 'Biblioteca de mídia' };
export const dynamic = 'force-dynamic';

const ROTULO: Record<EstadoUso, string> = { utilizavel: 'Utilizável', expirada: 'Licença expirada', direito_pendente: 'Direito pendente' };

export default async function MidiaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('midia')!);
  const { tipo, aviso } = await searchParams;
  const itens = getMidia().list();
  const hoje = hojeSP();
  const podeEscrever = checkAccess(session, ESCRITA_EDITORIAL).ok;
  return (
    <>
      <h1>Biblioteca de mídia</h1>
      <p>Todo ativo tem base de direito, crédito e texto alternativo. Na dúvida sobre o direito, o ativo não é utilizável.</p>
      <Flash tipo={tipo} aviso={aviso} />
      {itens.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum ativo na biblioteca</h2>
          <p>Registre o primeiro ativo abaixo. Upload de arquivos para o armazenamento (Blob) não está disponível sem o backend: por ora o registro é por URL, com a evidência da licença.</p>
        </section>
      ) : (
        <table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {itens.length} ativo(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Ativo</th>
              <th scope="col">Direito</th>
              <th scope="col">Expira</th>
              <th scope="col">Uso</th>
              {podeEscrever ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {itens.map((m) => {
              const e = estadoDeUso(m, hoje);
              return (
                <tr key={m.id}>
                  <th scope="row">
                    <a href={m.url} rel="noreferrer noopener">
                      {m.url}
                    </a>
                    <br />
                    <span className="st-hint">
                      {m.credito} · alt: {m.textoAlternativo}
                    </span>
                  </th>
                  <td>
                    {m.origem} / {m.baseDeDireito}
                  </td>
                  <td>{m.expiraEm ?? '—'}</td>
                  <td>
                    <span className={`st-badge ${e === 'utilizavel' ? 'aprovado' : 'bloqueado'}`}>{ROTULO[e]}</span>
                  </td>
                  {podeEscrever ? (
                    <td>
                      <form action={removerMidiaAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <button className="st-btn danger" type="submit" aria-label={`Remover ${m.url}`}>
                          Remover
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="novo">
          <h2 id="novo" style={{ marginTop: 0 }}>
            Registrar ativo
          </h2>
          <form action={registrarMidiaAction}>
            <div className="st-field">
              <label htmlFor="url">URL do ativo</label>
              <input id="url" name="url" type="url" />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="origem">Origem</label>
                <select id="origem" name="origem" defaultValue="propria">
                  <option value="propria">Própria</option>
                  <option value="licenciada">Licenciada</option>
                  <option value="fonte_terceiro">Fonte/terceiro (exige link)</option>
                  <option value="dominio_publico">Domínio público</option>
                  <option value="composicao_deterministica">Composição determinística</option>
                </select>
              </div>
              <div className="st-field">
                <label htmlFor="base">Base de direito</label>
                <select id="base" name="base" defaultValue="pendente">
                  <option value="pendente">Pendente (não utilizável)</option>
                  <option value="propria">Própria</option>
                  <option value="licenca">Licença</option>
                  <option value="autorizacao">Autorização</option>
                  <option value="dominio_publico">Domínio público</option>
                  <option value="excecao_validada">Exceção validada</option>
                </select>
              </div>
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="credito">Crédito</label>
                <input id="credito" name="credito" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="link">Link da fonte</label>
                <input id="link" name="link" type="url" />
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="alt">Texto alternativo</label>
              <input id="alt" name="alt" type="text" />
            </div>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="evidencia">Evidência da licença (protocolo ou URL)</label>
                <input id="evidencia" name="evidencia" type="text" />
              </div>
              <div className="st-field">
                <label htmlFor="expira">Expiração da licença</label>
                <input id="expira" name="expira" type="text" placeholder="AAAA-MM-DD" />
              </div>
            </div>
            <button className="st-btn" type="submit">
              Registrar ativo
            </button>
          </form>
        </section>
      ) : (
        <p className="st-hint">Seu papel só lê a biblioteca.</p>
      )}
      <SemBackend>Deduplicação por hash depende do upload.</SemBackend>
    </>
  );
}
