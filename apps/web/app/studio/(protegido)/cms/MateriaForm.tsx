'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { EDITORIAS } from '@ln/contracts';
import { salvarMateriaAction, type FormState } from './actions';
import { IdEvidencia } from '../../_components/IdEvidencia';

export interface EvidenciaOpcao {
  id: string;
  url: string;
  fonte: string;
  capturadoEm: string;
}

export interface ValorMateria {
  titulo: string;
  subtitulo: string;
  resumo: string;
  tipoConteudo: string;
  editoria: string;
  corpo: string;
  evidenceIds: string[];
  imagem: { url: string; origem: string; credito: string; link?: string; baseDeDireito: string; textoAlternativo: string } | null;
  patrocinado: boolean;
  rotulo: string;
}

const ORIGENS = [
  ['propria', 'Própria'],
  ['licenciada', 'Licenciada'],
  ['fonte_terceiro', 'Fonte/terceiro (exige link)'],
  ['dominio_publico', 'Domínio público'],
  ['composicao_deterministica', 'Composição determinística'],
] as const;
const BASES = [
  ['pendente', 'Pendente (não publica)'],
  ['propria', 'Própria'],
  ['licenca', 'Licença'],
  ['autorizacao', 'Autorização'],
  ['dominio_publico', 'Domínio público'],
  ['excecao_validada', 'Exceção validada'],
] as const;
const TIPOS = [
  ['noticia', 'Notícia'],
  ['flash', 'Loyalty Flash'],
  ['analise', 'Análise'],
  ['entrevista', 'Entrevista'],
  ['opiniao', 'Opinião'],
  ['estudo', 'Estudo'],
  ['patrocinado', 'Conteúdo patrocinado'],
  ['cobertura_evento', 'Cobertura de evento'],
] as const;

const inicial: FormState = { erros: {} };

/** Campo da API → id do controle na tela e rótulo no resumo de erros. */
const CAMPOS: Record<string, { id: string; rotulo: string }> = {
  titulo: { id: 'titulo', rotulo: 'Título' },
  subtitulo: { id: 'subtitulo', rotulo: 'Subtítulo' },
  resumo: { id: 'resumo', rotulo: 'Resumo' },
  editoria: { id: 'editoria', rotulo: 'Editoria' },
  tipoConteudo: { id: 'tipoConteudo', rotulo: 'Tipo de conteúdo' },
  corpo: { id: 'corpo', rotulo: 'Corpo da matéria' },
  evidenceIds: { id: 'evidenceIds', rotulo: 'Fontes' },
  'imagem.url': { id: 'img_url', rotulo: 'URL da imagem' },
  'imagem.baseDeDireito': { id: 'img_base', rotulo: 'Base de direito' },
  'imagem.credito': { id: 'img_credito', rotulo: 'Crédito' },
  'imagem.link': { id: 'img_link', rotulo: 'Link da fonte da imagem' },
  'imagem.textoAlternativo': { id: 'img_alt', rotulo: 'Texto alternativo' },
  rotuloPublieditorial: { id: 'rotulo', rotulo: 'Rótulo publieditorial' },
};

/** Erro de um campo: texto ligado ao controle por aria-describedby (o resumo do topo é quem anuncia, então aqui não há role=alert). */
function Err({ erros, campo }: { erros: Record<string, string>; campo: string }) {
  const id = CAMPOS[campo]?.id ?? campo;
  return erros[campo] ? (
    <span className="err" id={`${id}-erro`}>
      {erros[campo]}
    </span>
  ) : null;
}

/** Atributos de um controle com erro: aria-invalid e aria-describedby (junto da dica, se houver). */
const comErro = (erros: Record<string, string>, campo: string, dica?: string) => {
  const id = CAMPOS[campo]?.id ?? campo;
  const ids = [erros[campo] ? `${id}-erro` : null, dica ?? null].filter(Boolean).join(' ');
  return { ...(erros[campo] ? { 'aria-invalid': true as const } : {}), ...(ids ? { 'aria-describedby': ids } : {}) };
};

/** Rótulo com marcador de obrigatório FORA do <label> (o nome acessível do campo não muda; o campo leva aria-required). */
function Rotulo({ para, obrigatorio, children }: { para: string; obrigatorio?: boolean; children: ReactNode }) {
  return (
    <div className="st-label-linha">
      <label htmlFor={para}>{children}</label>
      {obrigatorio ? (
        <span className="st-obrig" aria-hidden="true">
          *
        </span>
      ) : null}
    </div>
  );
}

export function MateriaForm({ id, valor, evidencias, somenteLeitura }: { id?: string; valor?: ValorMateria; evidencias: EvidenciaOpcao[]; somenteLeitura?: boolean }) {
  const [state, action, pending] = useActionState(salvarMateriaAction, inicial);
  const v = valor;
  // campos editados depois do último envio deixam de mostrar o erro antigo (P2-06); um novo envio traz erros novos
  const [edicao, setEdicao] = useState<{ para: unknown; nomes: ReadonlySet<string> }>({ para: null, nomes: new Set() });
  const editados = edicao.para === state ? edicao.nomes : new Set<string>();
  const e = Object.fromEntries(Object.entries(state.erros).filter(([campo]) => !editados.has(campo)));
  // resumo dos erros no topo: ao chegar um resultado com erro, o foco vai para ele (leitor de tela e teclado)
  const resumoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.mensagem) resumoRef.current?.focus();
  }, [state]);
  const irAoCampo = (id: string) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  };
  return (
    <form
      action={action}
      aria-busy={pending}
      noValidate
      onChange={(ev) => {
        const nome = (ev.target as unknown as HTMLInputElement).name;
        if (nome) setEdicao((p) => ({ para: state, nomes: new Set([...(p.para === state ? p.nomes : []), nome]) }));
      }}
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.mensagem ? (
        <div ref={resumoRef} tabIndex={-1} className="st-alert err" role="alert" data-resumo-erros>
          <strong>{state.mensagem}</strong>
          {Object.keys(e).length > 0 ? (
            <ul>
              {Object.entries(e).map(([campo, msg]) => (
                <li key={campo}>
                  <a href={`#${CAMPOS[campo]?.id ?? campo}`} onClick={irAoCampo(CAMPOS[campo]?.id ?? campo)}>
                    {CAMPOS[campo]?.rotulo ?? campo}
                  </a>
                  : {msg}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {somenteLeitura ? null : (
        <p className="st-hint">
          <span className="st-obrig" aria-hidden="true">
            *
          </span>{' '}
          campo obrigatório para salvar.
        </p>
      )}
      {/* minWidth 0: um fieldset não encolhe abaixo do conteúdo por padrão, e um texto comprido estourava a tela no celular */}
      <fieldset disabled={somenteLeitura} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="st-field">
          <Rotulo para="titulo" obrigatorio>
            Título
          </Rotulo>
          <input id="titulo" name="titulo" type="text" defaultValue={v?.titulo} maxLength={220} aria-required="true" {...comErro(e, 'titulo')} />
          <Err erros={e} campo="titulo" />
        </div>
        <div className="st-field">
          <label htmlFor="subtitulo">Subtítulo (opcional)</label>
          <input id="subtitulo" name="subtitulo" type="text" defaultValue={v?.subtitulo} {...comErro(e, 'subtitulo')} />
          <Err erros={e} campo="subtitulo" />
        </div>
        <div className="st-field">
          <label htmlFor="resumo">Resumo (obrigatório para aprovar; até 300 caracteres)</label>
          <input id="resumo" name="resumo" type="text" defaultValue={v?.resumo} maxLength={320} {...comErro(e, 'resumo')} />
          <Err erros={e} campo="resumo" />
        </div>
        <div className="st-row">
          <div className="st-field">
            <Rotulo para="editoria" obrigatorio>
              Editoria
            </Rotulo>
            <select id="editoria" name="editoria" defaultValue={v?.editoria ?? ''} aria-required="true" {...comErro(e, 'editoria')}>
              <option value="" disabled>
                Escolha…
              </option>
              {EDITORIAS.map((ed) => (
                <option key={ed.slug} value={ed.slug}>
                  {ed.nome}
                </option>
              ))}
            </select>
            <Err erros={e} campo="editoria" />
          </div>
          <div className="st-field">
            <label htmlFor="tipoConteudo">Tipo de conteúdo</label>
            <select id="tipoConteudo" name="tipoConteudo" defaultValue={v?.tipoConteudo ?? 'noticia'} {...comErro(e, 'tipoConteudo')}>
              {TIPOS.map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
            <Err erros={e} campo="tipoConteudo" />
          </div>
        </div>
        <div className="st-field">
          <Rotulo para="corpo" obrigatorio>
            Corpo da matéria
          </Rotulo>
          <textarea id="corpo" name="corpo" defaultValue={v?.corpo} aria-required="true" {...comErro(e, 'corpo', 'corpo-dica')} />
          <span className="st-hint" id="corpo-dica">Assinatura institucional fixa: Redação Loyalty News. Não atribua autor humano.</span>
          <Err erros={e} campo="corpo" />
        </div>

        <fieldset className="st-field">
          <legend>Fontes (evidências capturadas; ao menos uma para ir à checagem)</legend>
          {evidencias.length === 0 ? (
            <p className="st-hint" data-vazio="evidencias">
              Nenhuma evidência disponível. Registre evidências em uma fonte ativa no Banco de fontes.
            </p>
          ) : (
            evidencias.map((ev) => (
              // nome da fonte e URL não têm espaço para quebrar
              <label key={ev.id} style={{ overflowWrap: 'anywhere' }}>
                <input type="checkbox" name="evidenceIds" value={ev.id} defaultChecked={v?.evidenceIds.includes(ev.id)} /> {ev.fonte}: {ev.url}
                <IdEvidencia id={ev.id} />
              </label>
            ))
          )}
          <Err erros={e} campo="evidenceIds" />
        </fieldset>

        <fieldset className="st-field">
          <legend>Imagem e base de direito</legend>
          <div className="st-field">
            <label htmlFor="img_url">URL da imagem</label>
            <input id="img_url" name="img_url" type="url" defaultValue={v?.imagem?.url} {...comErro(e, 'imagem.url')} />
            <Err erros={e} campo="imagem.url" />
          </div>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="img_origem">Origem</label>
              <select id="img_origem" name="img_origem" defaultValue={v?.imagem?.origem ?? 'propria'}>
                {ORIGENS.map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-field">
              <label htmlFor="img_base">Base de direito</label>
              <select id="img_base" name="img_base" defaultValue={v?.imagem?.baseDeDireito ?? 'pendente'} {...comErro(e, 'imagem.baseDeDireito')}>
                {BASES.map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
              <Err erros={e} campo="imagem.baseDeDireito" />
            </div>
          </div>
          <div className="st-row">
            <div className="st-field">
              <label htmlFor="img_credito">Crédito</label>
              <input id="img_credito" name="img_credito" type="text" defaultValue={v?.imagem?.credito} {...comErro(e, 'imagem.credito')} />
              <Err erros={e} campo="imagem.credito" />
            </div>
            <div className="st-field">
              <label htmlFor="img_link">Link da fonte da imagem</label>
              <input id="img_link" name="img_link" type="url" defaultValue={v?.imagem?.link} {...comErro(e, 'imagem.link')} />
              <Err erros={e} campo="imagem.link" />
            </div>
          </div>
          <div className="st-field">
            <label htmlFor="img_alt">Texto alternativo</label>
            <input id="img_alt" name="img_alt" type="text" defaultValue={v?.imagem?.textoAlternativo} {...comErro(e, 'imagem.textoAlternativo')} />
            <Err erros={e} campo="imagem.textoAlternativo" />
          </div>
          <span className="st-hint">Na dúvida sobre o direito, a imagem não publica (base &quot;pendente&quot;).</span>
        </fieldset>

        <div className="st-field">
          <label>
            <input type="checkbox" name="patrocinado" defaultChecked={v?.patrocinado} /> Conteúdo patrocinado
          </label>
          <label htmlFor="rotulo">Rótulo publieditorial</label>
          <input id="rotulo" name="rotulo" type="text" defaultValue={v?.rotulo} {...comErro(e, 'rotuloPublieditorial')} />
          <Err erros={e} campo="rotuloPublieditorial" />
        </div>
        {somenteLeitura ? null : (
          <div className="st-actions st-barra-salvar">
            <button className="st-btn" type="submit" disabled={pending}>
              {id ? 'Salvar como nova versão' : 'Criar rascunho'}
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
