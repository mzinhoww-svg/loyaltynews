'use server';

import { redirect } from 'next/navigation';
import { api, type MateriaDetalhe } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, type ErroApi, type RespostaApi } from '@/lib/studio/backend';
import { corpoAtualizacao, corpoCriacao, lerCampos, mesmasEvidencias } from '@/lib/studio/cms/materia-form';
import { CMS_EDIT, CMS_REVIEW } from '@/lib/studio/cms/roles';
import { montarCorrecao, type EdicaoFabrica } from '@/lib/studio/cms/fabrica-correcao';
import { urlPublicaDaMateria } from '@/lib/studio/cms/url-publica';
import { traduzirMensagem } from '@/lib/studio/erros';
import { checkAccess } from '@/lib/studio/modules';
import { requireStudio } from '../../_lib/guard';

export interface FormState {
  erros: Record<string, string>;
  mensagem?: string;
}

/** Erros de validação da API (details: [{path, message}]) viram mensagem por campo. */
function estadoDeErro(r: RespostaApi<unknown>): FormState {
  const e = (r.body as ErroApi | null)?.error;
  const erros: Record<string, string> = {};
  // o slug nasce do título e não é campo da tela: o erro dele não vira linha própria (o do Título já diz o que falta)
  if (Array.isArray(e?.details)) for (const d of e.details as { path?: string; message?: string }[]) if (d.path && d.path !== 'slug') erros[d.path] ??= traduzirMensagem(d.message ?? 'inválido');
  // com erros por campo a faixa só manda olhar os campos; sem eles, a mensagem do Backend (já traduzida)
  return { erros, mensagem: Object.keys(erros).length ? 'Corrija os campos destacados e envie de novo.' : mensagemErro(r) };
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

/**
 * Publicar só pela rota oficial de publicação (recibo válido da versão + flag publicacaoPortal + permissão materias:publish; a identidade de publicação é fixada pelo servidor). Serve à primeira
 * publicação e à correção (recibo da revisão aprovada ⇒ a matéria vira 'corrigido'). A transição genérica NÃO publica nem corrige.
 * As recusas aparecem como vêm.
 */
export async function publicarAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const id = t(fd, 'id');
  const correcao = t(fd, 'correcao') === '1';
  // com base do Portal configurada a URL é SEMPRE a canônica da matéria (a digitada é ignorada): erro de digitação não vai para o recibo
  const materia = await api.materias.obter(id);
  const canonica = !ehErro(materia) ? urlPublicaDaMateria(materia.body.data.slug) : '';
  const r = await api.editorial.publicar(id, { receiptId: t(fd, 'recibo'), url: canonica || t(fd, 'url') });
  ir(id, ehErro(r) ? 'err' : 'ok', ehErro(r) ? mensagemErro(r) : correcao ? 'Correção publicada: a matéria agora está corrigida.' : 'Publicação registrada.');
}

/** Cria ou refaz a revisão de correção de matéria publicada (a página pública não muda até a publicação oficial). Exige caso ACEITO. */
export async function salvarRevisaoAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_EDIT);
  const id = t(fd, 'id');
  const nulavel = (k: string) => t(fd, k) || null;
  const r = await api.materias.atualizar(id, {
    versaoEsperada: Number(t(fd, 'versaoEsperada')),
    casoCorrecaoId: t(fd, 'casoCorrecaoId'),
    titulo: t(fd, 'titulo'),
    subtitulo: nulavel('subtitulo'),
    resumo: nulavel('resumo'),
    corpo: t(fd, 'corpo'),
  });
  if (ehErro(r) && (r.body as ErroApi | null)?.error?.code === 'FACTORY_CORRECTION_ROUTE') {
    // matéria da Fábrica: o texto corrigido vem do rascunho editorial; a tela leva ao fluxo de recibo + publicação com `correcao`
    redirect(`/studio/cms/${encodeURIComponent(id)}/corrigir-fabrica?tipo=err&aviso=${encodeURIComponent(mensagemErro(r))}`);
  }
  ir(id, ehErro(r) ? 'err' : 'ok', ehErro(r) ? mensagemErro(r) : 'Revisão de correção salva. A página publicada não mudou; emita o recibo da revisão e publique.');
}

export async function descartarRevisaoAction(fd: FormData): Promise<void> {
  await requireStudio(CMS_EDIT);
  const id = t(fd, 'id');
  const r = await api.materias.descartarRevisao(id);
  ir(id, ehErro(r) ? 'err' : 'ok', ehErro(r) ? mensagemErro(r) : 'Revisão descartada. A página publicada não foi tocada.');
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

export interface EstadoCorrecao {
  tipo?: 'ok' | 'err';
  mensagem?: string;
  reciboId?: string;
  publicado?: boolean;
  valores: EdicaoFabrica & { url: string };
}

// o navegador envia quebras de linha de <textarea> como CRLF; o Backend separa Fontes:/Avisos: por LF
const lf = (x: string): string => x.replace(/\r\n?/g, '\n');
const bruto = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? lf(fd.get(k) as string) : '');

/**
 * Correção de matéria da FÁBRICA: o MESMO `correcao: {casoId, draft (sem bloco Avisos:), factcheck de outro provedor}` vai ao recibo
 * (POST /api/materias/{id}/recibos) e à publicação oficial. O rascunho completo é relido do Backend a cada passo (GET .../draft) e só os
 * textos editados são trocados; o hash depende do dia do aviso: recibo e publicação no mesmo dia (senão RECEIPT_CONTENT_MISMATCH e
 * é preciso reemitir). As recusas do Backend aparecem como vêm; o formulário mantém o que foi digitado.
 */
export async function corrigirFabricaAction(_prev: EstadoCorrecao, fd: FormData): Promise<EstadoCorrecao> {
  // recibo: quem tem materias:transition (revisor, chefia, admin); publicar: materias:publish (chefia, admin), seja quem for o emissor do recibo
  const { session } = await requireStudio(CMS_REVIEW);
  const id = t(fd, 'id');
  const op = t(fd, 'op');
  const valores: EstadoCorrecao['valores'] = {
    casoId: t(fd, 'casoId'),
    url: t(fd, 'url'),
    headline: bruto(fd, 'headline'),
    subtitulo: bruto(fd, 'subtitulo'),
    resumo: bruto(fd, 'resumo'),
    body: bruto(fd, 'body'),
    claimTexts: fd.getAll('claimText').map((x) => lf(String(x))),
    provider: t(fd, 'provider'),
    model: t(fd, 'model'),
    verdicts: fd.getAll('verdict').map(String),
  };
  const reciboAnterior = t(fd, 'recibo') || undefined;
  const falha = (mensagem: string): EstadoCorrecao => ({ tipo: 'err', mensagem, valores, ...(reciboAnterior ? { reciboId: reciboAnterior } : {}) });
  const base = await api.editorial.rascunho(id);
  if (ehErro(base)) return falha(mensagemErro(base));
  const c = montarCorrecao(base.body, valores);
  if (!c.ok) return falha(c.erro);
  if (op === 'recibo') {
    const checagens = fd.getAll('checagem').map((x) => ({ tipo: String(x), resultado: 'aprovado' as const }));
    if (checagens.length === 0) return falha('Marque ao menos uma checagem aprovada.');
    const r = await api.materias.emitirRecibo(id, { checagens, correcao: c.correcao });
    if (ehErro(r)) return falha(mensagemErro(r));
    const rec = (r.body as { data: { id: string; versao: number } }).data;
    return { tipo: 'ok', mensagem: `Recibo da versão corrigida (v${rec.versao}) emitido. Publique no mesmo dia: o hash depende do dia do aviso.`, reciboId: rec.id, valores };
  }
  if (op === 'publicar') {
    if (!checkAccess(session, ['admin', 'editor_chefe']).ok) return falha('Publicar é do editor-chefe ou do admin; o recibo emitido por outra pessoa vale.');
    if (!reciboAnterior) return falha('Emita o recibo da correção (ou informe o id do recibo) antes de publicar.');
    const canonica = urlPublicaDaMateria(String(base.body.rascunho.slug ?? ''));
    const r = await api.editorial.publicar(id, { receiptId: reciboAnterior, url: canonica || valores.url, correcao: c.correcao });
    if (ehErro(r)) return falha(mensagemErro(r));
    return { tipo: 'ok', mensagem: 'Correção publicada: a matéria agora está corrigida.', publicado: true, reciboId: reciboAnterior, valores };
  }
  return falha('Ação desconhecida.');
}
