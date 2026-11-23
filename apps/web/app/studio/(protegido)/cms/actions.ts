'use server';

import { redirect } from 'next/navigation';
import { api, type MateriaDetalhe } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, type ErroApi, type RespostaApi } from '@/lib/studio/backend';
import { corpoAtualizacao, corpoCriacao, lerCampos, mesmasEvidencias } from '@/lib/studio/cms/materia-form';
import { CMS_EDIT, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../_lib/guard';

export interface FormState {
  erros: Record<string, string>;
  mensagem?: string;
}

/** Erros de validação da API (details: [{path, message}]) viram mensagem por campo. */
function estadoDeErro(r: RespostaApi<unknown>): FormState {
  const e = (r.body as ErroApi | null)?.error;
  const erros: Record<string, string> = {};
  if (Array.isArray(e?.details)) for (const d of e.details as { path?: string; message?: string }[]) if (d.path) erros[d.path] ??= d.message ?? 'inválido';
  return { erros, mensagem: mensagemErro(r) };
}

const ir = (id: string, tipo: 'ok' | 'err', msg: string): never => redirect(`/studio/cms/${encodeURIComponent(id)}?tipo=${tipo}&aviso=${encodeURIComponent(msg)}`);

/** Cria (sem id) ou altera (com id; cada alteração soma 1 à versão no Backend). */
export async function salvarMateriaAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireStudio(CMS_EDIT);
  const campos = lerCampos(fd);
  const id = typeof fd.get('id') === 'string' ? (fd.get('id') as string) : '';
  if (!id) {
    const r = await api.materias.criar(corpoCriacao(campos));
    if (ehErro(r)) return estadoDeErro(r);
    return redirect(`/studio/cms/${r.body.data.id}?tipo=ok&aviso=${encodeURIComponent('Rascunho criado (v1).')}`);
  }
  const atual = await api.materias.obter(id);
  if (ehErro(atual)) return estadoDeErro(atual);
  const m = atual.body.data;
  let versao = m.versao;
  if (!mesmasEvidencias(m.fontes.map((f) => f.id), campos.evidenceIds)) {
    const f = await api.materias.definirFontes(id, { versaoEsperada: versao, evidenceIds: campos.evidenceIds });
    if (ehErro(f)) return estadoDeErro(f);
    versao = (f.body as { data: MateriaDetalhe }).data.versao;
  }
  const r = await api.materias.atualizar(id, corpoAtualizacao(campos, versao));
  if (ehErro(r)) return estadoDeErro(r);
  return redirect(`/studio/cms/${id}?tipo=ok&aviso=${encodeURIComponent(`Nova versão v${r.body.data.versao} salva.`)}`);
}

async function transicionar(id: string, para: string, nota: string | undefined, sucesso: string): Promise<never> {
  const r = await api.materias.transicao(id, { para, ...(nota ? { nota } : {}) });
  return ir(id, ehErro(r) ? 'err' : 'ok', ehErro(r) ? mensagemErro(r) : sucesso);
}

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

export async function enviarChecagemAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_EDIT);
  await transicionar(t(fd, 'id'), 'em_checagem', undefined, 'Enviada para checagem.');
}

export async function voltarRascunhoAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_EDIT);
  await transicionar(t(fd, 'id'), 'rascunho', undefined, 'Matéria voltou a rascunho.');
}

export async function emitirReciboAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_REVIEW);
  const id = t(fd, 'id');
  const checagens = fd.getAll('checagem').map((x) => ({ tipo: String(x), resultado: 'aprovado' as const }));
  if (checagens.length === 0) return ir(id, 'err', 'Marque ao menos uma checagem aprovada.');
  const r = await api.materias.emitirRecibo(id, { versao: Number(t(fd, 'versao')), checagens });
  ir(id, ehErro(r) ? 'err' : 'ok', ehErro(r) ? mensagemErro(r) : 'Recibo da versão emitido.');
}

export async function aprovarAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_REVIEW);
  await transicionar(t(fd, 'id'), 'aprovado', t(fd, 'nota') || undefined, 'Matéria aprovada.');
}

export async function bloquearAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_REVIEW);
  await transicionar(t(fd, 'id'), 'bloqueado', t(fd, 'nota'), 'Matéria bloqueada.');
}

// ---------- fila da Fábrica editorial (revisão humana) ----------
const REVISAO = ['admin', 'editor_chefe', 'revisor'] as const;

export async function rechecarAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_EDIT);
  const id = t(fd, 'id');
  const r = await api.editorial.rechecar(id);
  redirect(`/studio/cms/checagem/${encodeURIComponent(id)}?tipo=${ehErro(r) ? 'err' : 'ok'}&aviso=${encodeURIComponent(ehErro(r) ? mensagemErro(r) : 'Nova checagem enfileirada.')}`);
}

export async function decidirRevisaoAction(fd: FormData): Promise<void> {
  await requireStudio(REVISAO);
  const id = t(fd, 'id');
  const r = await api.editorial.decidir(id, { articleId: id, decision: t(fd, 'decisao'), note: t(fd, 'nota') });
  redirect(`/studio/cms/checagem/${encodeURIComponent(id)}?tipo=${ehErro(r) ? 'err' : 'ok'}&aviso=${encodeURIComponent(ehErro(r) ? mensagemErro(r) : 'Decisão de revisão registrada.')}`);
}
