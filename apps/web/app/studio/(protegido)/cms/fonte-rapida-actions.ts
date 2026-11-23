'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, type ErroApi, type RespostaApi } from '@/lib/studio/backend';
import { montarEvidencia, montarFonteRapida, mensagemDoCodigo } from '@/lib/studio/cms/fonte-rapida';
import { CMS_EDIT } from '@/lib/studio/cms/roles';
import { retornoSeguro } from '@/lib/studio/site-docs';
import { requireStudio } from '../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
const TRECHO = (fd: FormData) => ((typeof fd.get('trecho') === 'string' ? (fd.get('trecho') as string) : '').replace(/\r\n?/g, '\n'));

function volta(fd: FormData, ok: boolean, msg: string, extra: Record<string, string> = {}): never {
  const base = retornoSeguro(t(fd, 'retorno'), '/studio/cms');
  const [caminho, query = ''] = base.split('?');
  const p = new URLSearchParams(query);
  p.set('tipo', ok ? 'ok' : 'err');
  p.set('aviso', msg);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  redirect(`${caminho}?${p.toString()}`);
}

/** O que a pessoa digitou volta ao formulário quando há erro (nada se perde); só texto curto, na query. */
const eco = (fd: FormData, prefixo: 'fr' | 'ev', campos: string[]): Record<string, string> =>
  Object.fromEntries(campos.map((c) => [`${prefixo}_${c}`, (c === 'trecho' ? TRECHO(fd) : t(fd, c)).slice(0, 700)]).filter(([, v]) => v));
const CAMPOS_FONTE = ['url', 'nome', 'tipo', 'licenca', 'editoria'];
const CAMPOS_EVIDENCIA = ['url', 'trecho'];

/** Mensagem do Backend para a pessoa: códigos do contrato com texto próprio; o resto passa pelo tradutor de erros comum. */
function textoDoErro(r: RespostaApi<unknown> & { ok: false }): string {
  const e = (r.body as ErroApi | null)?.error;
  if (r.status === 404 && e?.code === 'NOT_FOUND' && /Rota inexistente/i.test(e.message)) {
    return 'A fonte rápida ainda não está disponível neste ambiente (a rota do Backend não foi publicada). Cadastre a fonte no Banco de fontes.';
  }
  return mensagemDoCodigo(e?.code, e?.details, mensagemErro(r));
}

/**
 * Cria uma fonte rápida SEM sair da tela da matéria. A fonte nasce "a confirmar" e INATIVA: não coleta nada até alguém revisar os termos e ativá-la
 * no Banco de fontes. A chave de idempotência vem do formulário: reenviar não duplica. Editor ou superior.
 */
export async function criarFonteRapidaAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_EDIT);
  const v = montarFonteRapida({ chave: t(fd, 'chave'), url: t(fd, 'url'), nome: t(fd, 'nome'), tipo: t(fd, 'tipo'), licenca: t(fd, 'licenca'), editoria: t(fd, 'editoria') });
  if (!v.ok) return volta(fd, false, v.erro, eco(fd, 'fr', CAMPOS_FONTE));
  const r = await api.fonteRapida.criar(v.corpo);
  if (ehErro(r)) {
    // URL já cadastrada: leva a fonte existente para o formulário de evidência
    const e = (r.body as ErroApi | null)?.error;
    const existente = e?.code === 'SOURCE_EXISTS' ? (e.details as { id?: string } | undefined)?.id : undefined;
    return volta(fd, false, textoDoErro(r), { ...eco(fd, 'fr', CAMPOS_FONTE), ...(existente ? { fonte: existente } : {}) });
  }
  const f = r.body.data;
  volta(fd, true, `${r.body.existente ? 'Esta fonte já tinha sido criada (reenvio seguro). ' : ''}Fonte “${f.nome}” criada como a confirmar e inativa: não coleta nada até alguém revisar os termos e ativá-la no Banco de fontes.`, { fonte: f.id });
}

/** Anexa uma evidência (URL + trecho de até 500 caracteres) à matéria em rascunho. Fica a confirmar e não conta para os gates de publicação. */
export async function anexarEvidenciaAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_EDIT);
  const sourceId = t(fd, 'sourceId');
  const v = montarEvidencia({ chave: t(fd, 'chave'), articleId: t(fd, 'articleId'), url: t(fd, 'url'), trecho: TRECHO(fd), ...(sourceId ? { sourceId } : {}) });
  if (!v.ok) return volta(fd, false, v.erro, { ...eco(fd, 'ev', CAMPOS_EVIDENCIA), ...(sourceId ? { fonte: sourceId } : {}) });
  const r = await api.fonteRapida.anexarEvidencia(v.corpo);
  if (ehErro(r)) return volta(fd, false, textoDoErro(r), { ...eco(fd, 'ev', CAMPOS_EVIDENCIA), ...(sourceId ? { fonte: sourceId } : {}) });
  volta(fd, true, `${r.body.existente ? 'Esta evidência já tinha sido anexada (reenvio seguro). ' : ''}Evidência anexada como a confirmar: ela guarda só o trecho e não conta para os gates de publicação.`);
}
