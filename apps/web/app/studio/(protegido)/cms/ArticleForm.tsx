'use client';

import { useActionState } from 'react';
import { EDITORIAS } from '@ln/contracts';
import { FONTES_LINHAS } from '@/lib/studio/cms/form';
import type { VersionInput } from '@/lib/studio/cms/articles';
import { saveArticleAction, type FormState } from './actions';

const ORIGENS = [
  ['propria', 'Própria'],
  ['licenciada', 'Licenciada'],
  ['fonte_terceiro', 'Fonte/terceiro (exige link)'],
  ['dominio_publico', 'Domínio público'],
  ['composicao_deterministica', 'Composição determinística'],
] as const;

const BASES = [
  ['pendente', 'Pendente (não segue para checagem)'],
  ['propria', 'Própria'],
  ['licenca', 'Licença'],
  ['autorizacao', 'Autorização'],
  ['dominio_publico', 'Domínio público'],
  ['excecao_validada', 'Exceção validada'],
] as const;

const initial: FormState = { erros: {} };

function Err({ erros, campo }: { erros: Record<string, string>; campo: string }) {
  return erros[campo] ? (
    <span className="err" id={`err-${campo}`} role="alert">
      {erros[campo]}
    </span>
  ) : null;
}

export function ArticleForm({ id, valor, somenteLeitura }: { id?: string; valor?: VersionInput; somenteLeitura?: boolean }) {
  const [state, action, pending] = useActionState(saveArticleAction, initial);
  const e = state.erros;
  const v = valor;
  const dis = Boolean(somenteLeitura);
  return (
    <form action={action} noValidate>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.mensagem ? (
        <div className="st-alert err" role="alert">
          {state.mensagem}
          {Object.keys(e).length ? (
            <ul>
              {Object.entries(e).map(([k, m]) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={dis} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="st-field">
          <label htmlFor="titulo">Título</label>
          <input id="titulo" name="titulo" type="text" defaultValue={v?.titulo} aria-describedby={e.titulo ? 'err-titulo' : undefined} aria-invalid={Boolean(e.titulo)} maxLength={220} />
          <Err erros={e} campo="titulo" />
        </div>
        <div className="st-field">
          <label htmlFor="subtitulo">Subtítulo (opcional)</label>
          <input id="subtitulo" name="subtitulo" type="text" defaultValue={v?.subtitulo} />
          <Err erros={e} campo="subtitulo" />
        </div>
        <div className="st-field">
          <label htmlFor="editoria">Editoria</label>
          <select id="editoria" name="editoria" defaultValue={v?.editoria ?? ''}>
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
          <label htmlFor="corpo">Corpo da matéria</label>
          <textarea id="corpo" name="corpo" defaultValue={v?.corpo} />
          <span className="st-hint">Assinatura institucional fixa: Redação Loyalty News. Não atribua autor humano.</span>
          <Err erros={e} campo="corpo" />
        </div>

        <fieldset className="st-field">
          <legend>Fontes verificáveis (mínimo 1 para ir à checagem)</legend>
          {Array.from({ length: FONTES_LINHAS }, (_, i) => (
            <div className="st-row" key={i}>
              <div className="st-field">
                <label htmlFor={`fonte_nome_${i}`}>Fonte {i + 1}: nome</label>
                <input id={`fonte_nome_${i}`} name={`fonte_nome_${i}`} type="text" defaultValue={v?.fontes[i]?.nome} />
              </div>
              <div className="st-field">
                <label htmlFor={`fonte_url_${i}`}>Fonte {i + 1}: URL</label>
                <input id={`fonte_url_${i}`} name={`fonte_url_${i}`} type="url" defaultValue={v?.fontes[i]?.url} />
                <Err erros={e} campo={`fontes.${i}.url`} />
                <Err erros={e} campo={`fontes.${i}`} />
              </div>
            </div>
          ))}
          <Err erros={e} campo="fontes" />
        </fieldset>

        <fieldset className="st-field">
          <legend>Imagem e base de direito</legend>
          <div className="st-field">
            <label htmlFor="img_url">URL da imagem</label>
            <input id="img_url" name="img_url" type="url" defaultValue={v?.imagem?.url} />
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
              <select id="img_base" name="img_base" defaultValue={v?.imagem?.baseDeDireito ?? 'pendente'}>
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
              <input id="img_credito" name="img_credito" type="text" defaultValue={v?.imagem?.credito} />
              <Err erros={e} campo="imagem.credito" />
            </div>
            <div className="st-field">
              <label htmlFor="img_link">Link da fonte da imagem</label>
              <input id="img_link" name="img_link" type="url" defaultValue={v?.imagem?.link} />
              <Err erros={e} campo="imagem.link" />
            </div>
          </div>
          <div className="st-field">
            <label htmlFor="img_alt">Texto alternativo</label>
            <input id="img_alt" name="img_alt" type="text" defaultValue={v?.imagem?.textoAlternativo} />
            <Err erros={e} campo="imagem.textoAlternativo" />
          </div>
          <span className="st-hint">Só enquadramento, tamanho e compressão são edições permitidas. Na dúvida sobre o direito, a imagem não segue.</span>
        </fieldset>

        <div className="st-field">
          <label>
            <input type="checkbox" name="patrocinado" defaultChecked={v?.patrocinado} /> Conteúdo patrocinado
          </label>
          <label htmlFor="rotulo">Rótulo publieditorial</label>
          <input id="rotulo" name="rotulo" type="text" defaultValue={v?.rotuloPublieditorial} />
          <Err erros={e} campo="rotuloPublieditorial" />
        </div>
        {id ? (
          <div className="st-field">
            <label htmlFor="nota">Nota da versão (o que mudou)</label>
            <input id="nota" name="nota" type="text" />
          </div>
        ) : null}
        {dis ? null : (
          <div className="st-actions">
            <button className="st-btn" type="submit" disabled={pending}>
              {id ? 'Salvar como nova versão' : 'Criar rascunho'}
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
