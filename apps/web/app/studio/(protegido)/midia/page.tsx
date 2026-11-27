import type { Metadata } from 'next';
import { EmptyState } from '@ln/ui';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { requireModule } from '../../_lib/guard';
import { Flash } from '../../_components/Flash';
import { QuadroRolavel } from '../../_components/QuadroRolavel';
import { SemBanco } from '../../_components/SemBanco';
import { Recarregar } from '../../_components/Recarregar';
import { enviarArquivoAction, registrarMidiaAction, removerMidiaAction, renovarLicencaAction } from './actions';

export const metadata: Metadata = { title: 'Biblioteca de mídia' };
export const dynamic = 'force-dynamic';

const LICENCA: Record<string, string> = { sem_expiracao: 'Sem expiração', valida: 'Licença válida', vence_em_breve: 'Vence em breve', vencida: 'Licença vencida' };

function CamposDireito({ prefixo }: { prefixo: string }) {
  const id = (n: string) => `${prefixo}-${n}`;
  return (
    <>
      <div className="st-row">
        <div className="st-field">
          <label htmlFor={id('origem')}>Origem</label>
          <select id={id('origem')} name="origem" defaultValue="propria">
            <option value="propria">Própria</option>
            <option value="licenciada">Licenciada</option>
            <option value="fonte_terceiro">Fonte/terceiro (exige link)</option>
            <option value="dominio_publico">Domínio público</option>
            <option value="composicao_deterministica">Composição determinística</option>
          </select>
        </div>
        <div className="st-field">
          <label htmlFor={id('base')}>Base de direito</label>
          <select id={id('base')} name="base" defaultValue="pendente">
            <option value="pendente">Pendente (não publicável)</option>
            <option value="propria">Própria</option>
            <option value="licenca">Licença (exige evidência)</option>
            <option value="autorizacao">Autorização (exige evidência)</option>
            <option value="dominio_publico">Domínio público</option>
            <option value="excecao_validada">Exceção validada (exige evidência)</option>
          </select>
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label htmlFor={id('credito')}>Crédito</label>
          <input id={id('credito')} name="credito" type="text" />
        </div>
        <div className="st-field">
          <label htmlFor={id('link')}>Link da fonte</label>
          <input id={id('link')} name="link" type="url" />
        </div>
      </div>
      <div className="st-field">
        <label htmlFor={id('alt')}>Texto alternativo</label>
        <input id={id('alt')} name="alt" type="text" />
      </div>
      <div className="st-row">
        <div className="st-field">
          <label htmlFor={id('expira')}>Expiração da licença (AAAA-MM-DD)</label>
          <input id={id('expira')} name="expira" type="text" />
        </div>
        <div className="st-field">
          <label htmlFor={id('evtipo')}>Tipo da evidência da licença</label>
          <select id={id('evtipo')} name="evidenciaTipo" defaultValue="url">
            <option value="url">URL (termos/página)</option>
            <option value="contrato">Contrato</option>
            <option value="email">E-mail</option>
            <option value="documento">Documento</option>
          </select>
        </div>
      </div>
      <div className="st-row">
        <div className="st-field">
          <label htmlFor={id('evref')}>Referência da evidência</label>
          <input id={id('evref')} name="evidencia" type="text" />
        </div>
        <div className="st-field">
          <label htmlFor={id('evdesc')}>Descrição da evidência (opcional)</label>
          <input id={id('evdesc')} name="evidenciaDescricao" type="text" />
        </div>
      </div>
    </>
  );
}

export default async function MidiaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; aviso?: string; filtro?: string; vencendo?: string; vencida?: string }> }) {
  const { session } = await requireModule(findModule('midia')!);
  const { tipo, aviso, filtro = '', vencendo = '', vencida = '' } = await searchParams;
  const r = await api.midia.listar({ tipo: filtro, vencendo, vencida });
  if (naoConfigurado(r)) {
    return (
      <>
        <h1>Biblioteca de mídia</h1>
        <SemBanco modulo="A biblioteca de mídia" />
      </>
    );
  }
  // 400 = filtro recusado (a pessoa ajusta); qualquer outro erro é falha de leitura (a tela oferece tentar de novo).
  const filtroInvalido = ehErro(r) && r.status === 400;
  const falhaLeitura = ehErro(r) && r.status !== 400;
  const itens = ehErro(r) ? [] : r.body.data;
  const filtrando = Boolean(filtro || vencendo || vencida);
  const podeEscrever = checkAccess(session, ['admin', 'editor_chefe', 'editor']).ok;
  const podeRemover = checkAccess(session, ['admin', 'editor_chefe']).ok;
  return (
    <>
      <h1>Biblioteca de mídia</h1>
      <p>Todo ativo tem base de direito, crédito e texto alternativo; na dúvida sobre o direito, ou com a licença vencida, o ativo não é publicável. Licença, autorização e exceção exigem evidência. Um ativo por conteúdo (SHA-256): reenviar o mesmo arquivo não duplica.</p>
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
        <div className="st-field">
          <label htmlFor="vencendo">Licença vence em até (dias)</label>
          <input id="vencendo" name="vencendo" type="text" defaultValue={vencendo} />
        </div>
        <div className="st-field">
          <label htmlFor="vencida">Licença vencida</label>
          <select id="vencida" name="vencida" defaultValue={vencida}>
            <option value="">—</option>
            <option value="true">Só vencidas</option>
          </select>
        </div>
        <button className="st-btn sec" type="submit">
          Filtrar
        </button>
      </form>
      {falhaLeitura ? (
        <div className="st-alert err" role="alert">
          Não foi possível carregar a biblioteca de mídia: {mensagemErro(r)}
          <Recarregar />
        </div>
      ) : filtroInvalido ? (
        <div className="st-alert err" role="alert">
          Filtro inválido: {mensagemErro(r)}
        </div>
      ) : itens.length === 0 ? (
        <EmptyState title={filtrando ? 'Nenhum ativo com esses filtros' : 'Nenhum ativo na biblioteca'} description={filtrando ? 'Ajuste os filtros.' : 'Registre o primeiro ativo abaixo, com a base de direito.'} />
      ) : (
        <QuadroRolavel rotulo="Biblioteca de mídia">
<table className="st-table">
          <caption className="st-hint" style={{ textAlign: 'left' }}>
            {itens.length} ativo(s)
          </caption>
          <thead>
            <tr>
              <th scope="col">Ativo</th>
              <th scope="col">Direito</th>
              <th scope="col">Licença</th>
              <th scope="col">Uso</th>
              {podeEscrever ? <th scope="col">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {itens.map((m) => (
              <tr key={m.id} data-midia={m.id}>
                <th scope="row">
                  <a href={m.direitos.url} rel="noreferrer noopener">
                    {m.direitos.url}
                  </a>
                  <br />
                  <span className="st-hint">
                    {m.tipo} · {m.direitos.credito} · alt: {m.direitos.textoAlternativo} · sha256 {m.sha256.slice(0, 12)}… · {m.temArquivo ? 'arquivo armazenado' : 'sem arquivo (só metadados)'}
                  </span>
                </th>
                <td>
                  {m.direitos.origem} / {m.direitos.baseDeDireito}
                </td>
                <td>
                  {LICENCA[m.licencaStatus] ?? m.licencaStatus}
                  {m.licencaExpiraEm ? ` (até ${m.licencaExpiraEm})` : ''}
                  {m.licencaEvidencia ? (
                    <>
                      <br />
                      <span className="st-hint">
                        evidência {m.licencaEvidencia.tipo}: {m.licencaEvidencia.referencia}
                      </span>
                    </>
                  ) : null}
                </td>
                <td>
                  <span className={`st-badge ${m.publicavel ? 'aprovado' : 'bloqueado'}`}>{m.publicavel ? 'Publicável' : m.licencaStatus === 'vencida' ? 'Licença vencida' : 'Direito pendente'}</span>
                </td>
                {podeEscrever ? (
                  <td>
                    <form action={renovarLicencaAction} className="st-actions" aria-label={`Renovar licença de ${m.direitos.url}`}>
                      <input type="hidden" name="id" value={m.id} />
                      <input name="expira" type="text" placeholder="Nova expiração" aria-label={`Nova expiração de ${m.direitos.url}`} />
                      <button className="st-btn sec" type="submit" aria-label={`Renovar licença ${m.direitos.url}`}>
                        Renovar
                      </button>
                    </form>
                    {podeRemover ? (
                      <form action={removerMidiaAction} style={{ marginTop: 6 }}>
                        <input type="hidden" name="id" value={m.id} />
                        <button className="st-btn danger" type="submit" aria-label={`Remover ${m.direitos.url}`}>
                          Remover
                        </button>
                      </form>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
</QuadroRolavel>
      )}
      {podeEscrever ? (
        <>
          <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="envio">
            <h2 id="envio" style={{ marginTop: 0 }}>
              Enviar arquivo
            </h2>
            <p className="st-hint">JPEG, PNG, GIF ou WebP até 5 MB; PDF até 10 MB. Tipo e hash vêm do conteúdo, não do nome. SVG e HTML são recusados. Sem armazenamento configurado, o Backend recusa o envio.</p>
            <form action={enviarArquivoAction} encType="multipart/form-data">
              <div className="st-field">
                <label htmlFor="arquivo">Arquivo</label>
                <input id="arquivo" name="arquivo" type="file" />
              </div>
              <CamposDireito prefixo="up" />
              <button className="st-btn" type="submit">
                Enviar arquivo
              </button>
            </form>
          </section>
          <section className="st-card" style={{ marginTop: 18 }} aria-labelledby="novo">
            <h2 id="novo" style={{ marginTop: 0 }}>
              Registrar ativo hospedado fora
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
              <CamposDireito prefixo="reg" />
              <button className="st-btn" type="submit">
                Registrar ativo
              </button>
            </form>
          </section>
        </>
      ) : (
        <p className="st-hint">Seu papel só lê a biblioteca.</p>
      )}
    </>
  );
}
