import type { Metadata } from 'next';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { SemBanco } from '../../_components/SemBanco';
import { registrarMidiaAction, removerMidiaAction } from './actions';

export const metadata: Metadata = { title: 'Biblioteca de mídia' };
export const dynamic = 'force-dynamic';

export default async function MidiaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; filtro?: string }> }) {
  const { session } = await requireModule(findModule('midia')!);
  const { tipo, aviso, filtro = '' } = await searchParams;
  const r = await api.midia.listar({ tipo: filtro });
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Biblioteca de mídia</h1>
        <SemBanco modulo="A biblioteca de mídia" />
      </>
    );
  }
  const filtroInvalido = ehErro(r);
  const itens = filtroInvalido ? [] : r.body.data;
  const podeEscrever = checkAccess(session, ['admin', 'editor_chefe', 'editor']).ok;
  const podeRemover = checkAccess(session, ['admin', 'editor_chefe']).ok;
  return (
    <>
      <h1>Biblioteca de mídia</h1>
      <p>Todo ativo tem base de direito, crédito e texto alternativo; na dúvida sobre o direito o ativo não é publicável. O upload do arquivo para o armazenamento ainda não está ligado: o registro guarda os metadados e o hash SHA-256 do arquivo.</p>
      <Flash tipo={tipo} aviso={aviso} />
      <form className="st-filters" method="get" role="search" aria-label="Filtrar mídia">
        <div className="st-field">
          <label htmlFor="filtro">Tipo</label>
          <select id="filtro" name="filtro" defaultValue={filtro}>
            <option value="">Todos</option>
            <option value="imagem">Imagem</option>
            <option value="video">Vídeo</option>
            <option value="documento">Documento</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {filtroInvalido ? (
        <div className="st-alert err" role="alert">
          Filtro inválido: {mensagemErro(r)}
        </div>
      ) : itens.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio">
          <h2 id="vazio">Nenhum ativo na biblioteca</h2>
          <p>Registre o primeiro ativo abaixo, com a base de direito.</p>
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
              <th scope="col">Uso</th>
              {podeRemover ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {itens.map((m) => (
              <tr key={m.id}>
                <th scope="row">
                  <a href={m.direitos.url} rel="noreferrer noopener">
                    {m.direitos.url}
                  </a>
                  <br />
                  <span className="st-hint">
                    {m.tipo} · {m.direitos.credito} · alt: {m.direitos.textoAlternativo} · sha256 {m.sha256.slice(0, 12)}…
                  </span>
                </th>
                <td>
                  {m.direitos.origem} / {m.direitos.baseDeDireito}
                </td>
                <td>
                  <span className={`st-badge ${m.publicavel ? 'aprovado' : 'bloqueado'}`}>{m.publicavel ? 'Publicável' : 'Direito pendente'}</span>
                </td>
                {podeRemover ? (
                  <td>
                    <form action={removerMidiaAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="st-btn danger" type="submit" aria-label={`Remover ${m.direitos.url}`}>
                        Remover
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {podeEscrever ? (
        <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="novo">
          <h2 id="novo" style={{ marginTop: 0 }}>
            Registrar ativo
          </h2>
          <form action={registrarMidiaAction}>
            <div className="st-row">
              <div className="st-field">
                <label htmlFor="url">URL do ativo</label>
                <input id="url" name="url" type="url" />
              </div>
              <div className="st-field">
                <label htmlFor="tipo-ativo">Tipo</label>
                <select id="tipo-ativo" name="tipo" defaultValue="imagem">
                  <option value="imagem">Imagem</option>
                  <option value="video">Vídeo</option>
                  <option value="documento">Documento</option>
                </select>
              </div>
            </div>
            <div className="st-field">
              <label htmlFor="sha256">SHA-256 do arquivo (64 caracteres hexadecimais)</label>
              <input id="sha256" name="sha256" type="text" />
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
                  <option value="pendente">Pendente (não publicável)</option>
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
            <button className="st-btn" type="submit">
              Registrar ativo
            </button>
          </form>
        </section>
      ) : (
        <p className="st-hint">Seu papel só lê a biblioteca.</p>
      )}
    </>
  );
}
