'use client';

import { useActionState } from 'react';
import { EDITORIAS } from '@ln/contracts';
import { salvarMateriaAction, type FormState } from './actions';

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

function Err({ erros, campo }: { erros: Record<string, string>; campo: string }) {
  return erros[campo] ? (
    <span className="err" role="alert">
      {erros[campo]}
    </span>
  ) : null;
}

export function MateriaForm({ id, valor, evidencias, somenteLeitura }: { id?: string; valor?: ValorMateria; evidencias: EvidenciaOpcao[]; somenteLeitura?: boolean }) {
  const [state, action, pending] = useActionState(salvarMateriaAction, inicial);
  const e = state.erros;
  const v = valor;
  return (
    <form action={action} noValidate>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.mensagem ? (
        <div className="st-alert err" role="alert">
          {state.mensagem}
        </div>
      ) : null}
      <fieldset disabled={somenteLeitura} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="st-field">
          <label htmlFor="titulo">Título</label>
          <input id="titulo" name="titulo" type="text" defaultValue={v?.titulo} maxLength={220} />
          <Err erros={e} campo="titulo" />
        </div>
        <div className="st-field">
          <label htmlFor="subtitulo">Subtítulo (opcional)</label>
          <input id="subtitulo" name="subtitulo" type="text" defaultValue={v?.subtitulo} />
          <Err erros={e} campo="subtitulo" />
        </div>
        <div className="st-field">
          <label htmlFor="resumo">Resumo (obrigatório para aprovar; até 300 caracteres)</label>
          <input id="resumo" name="resumo" type="text" defaultValue={v?.resumo} maxLength={320} />
          <Err erros={e} campo="resumo" />
        </div>
        <div className="st-row">
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
            <label htmlFor="tipoConteudo">Tipo de conteúdo</label>
            <select id="tipoConteudo" name="tipoConteudo" defaultValue={v?.tipoConteudo ?? 'noticia'}>
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
          <label htmlFor="corpo">Corpo da matéria</label>
          <textarea id="corpo" name="corpo" defaultValue={v?.corpo} />
          <span className="st-hint">Assinatura institucional fixa: Redação Loyalty News. Não atribua autor humano.</span>
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
              <label key={ev.id}>
                <input type="checkbox" name="evidenceIds" value={ev.id} defaultChecked={v?.evidenceIds.includes(ev.id)} /> {ev.fonte}: {ev.url}
              </label>
            ))
          )}
          <Err erros={e} campo="evidenceIds" />
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
          <span className="st-hint">Na dúvida sobre o direito, a imagem não publica (base &quot;pendente&quot;).</span>
        </fieldset>

        <div className="st-field">
          <label>
            <input type="checkbox" name="patrocinado" defaultChecked={v?.patrocinado} /> Conteúdo patrocinado
          </label>
          <label htmlFor="rotulo">Rótulo publieditorial</label>
          <input id="rotulo" name="rotulo" type="text" defaultValue={v?.rotulo} />
          <Err erros={e} campo="rotuloPublieditorial" />
        </div>
        {somenteLeitura ? null : (
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
