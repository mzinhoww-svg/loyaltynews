'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, type ErroApi, type RespostaApi } from '@/lib/studio/backend';
import { elegiveisParaLote, filtroEstado, mensagemDeHabilitar, resumoDoLote, type FonteFabrica, type ResultadoCartao } from '@/lib/studio/fabrica-fontes';
import { requireStudio } from '../../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
const erroDe = (r: RespostaApi<unknown> & { ok: false }) => (r.body as ErroApi | null)?.error;

/**
 * Habilitar / desabilitar NO CARD (DP-51): a ação devolve o resultado e a fonte atualizada; a tela troca o card no lugar, sem navegar,
 * então a posição da rolagem e o foco ficam. O administrador habilita direto com um clique (revisão implícita, auditada); fonte com aviso de
 * segurança pede a confirmação. Editor-chefe segue o caminho formal (revisão registrada); revisor só desabilita.
 */
export async function alternarFonteAction(_anterior: ResultadoCartao | null, fd: FormData): Promise<ResultadoCartao> {
  const ligar = t(fd, 'op') === 'habilitar';
  const { session } = await requireStudio(ligar ? ['admin', 'editor_chefe'] : ['admin', 'editor_chefe', 'revisor']);
  const ehAdmin = session.roles.includes('admin');
  const sourceId = t(fd, 'sourceId');
  const observacao = t(fd, 'observacao');
  const r = await api.editorial.habilitarFonte(sourceId, ligar, ligar && ehAdmin ? { direto: true, ...(observacao ? { observacao } : {}), ...(fd.get('confirmarRisco') === 'on' ? { confirmarRisco: true } : {}) } : undefined);
  if (ehErro(r)) {
    const e = erroDe(r);
    const riscos = (e?.details as { riscos?: string[]; precisaConfirmar?: boolean } | undefined)?.precisaConfirmar ? (e!.details as { riscos: string[] }).riscos : undefined;
    return { ok: false, mensagem: mensagemDeHabilitar(e?.code, mensagemErro(r), ehAdmin), ...(riscos ? { confirmar: riscos } : {}) };
  }
  const fonte = r.body as unknown as FonteFabrica;
  return { ok: true, fonte, mensagem: ligar ? (ehAdmin ? 'Fonte habilitada. Ficou registrado quem habilitou e quando.' : 'Fonte habilitada.') : 'Fonte desabilitada.' };
}

/** Revisão FORMAL dos termos (revisor independente; nota de pelo menos 20 caracteres). Não habilita. Também no lugar, sem recarregar. */
export async function revisarFonteCartaoAction(_anterior: ResultadoCartao | null, fd: FormData): Promise<ResultadoCartao> {
  await requireStudio(['admin', 'editor_chefe', 'revisor']);
  const r = await api.editorial.revisarFonte(t(fd, 'sourceId'), {
    sourceId: t(fd, 'sourceId'),
    termsStatus: t(fd, 'termos'),
    termsNote: t(fd, 'nota'),
    urlVerified: fd.get('urlVerificada') === 'on',
    robotsChecked: fd.get('robots') === 'on',
    paywall: t(fd, 'paywall') || 'none',
  });
  if (ehErro(r)) return { ok: false, mensagem: mensagemErro(r) };
  return { ok: true, fonte: r.body as unknown as FonteFabrica, mensagem: 'Revisão registrada. A fonte continua desabilitada até a habilitação.' };
}

/** Ponto de entrada único do card (uma resposta por vez, a mais recente manda): `acao` = 'alternar' (habilitar/desabilitar) ou 'revisar'. */
export async function acaoDoCartaoAction(anterior: ResultadoCartao | null, fd: FormData): Promise<ResultadoCartao> {
  return t(fd, 'acao') === 'revisar' ? revisarFonteCartaoAction(anterior, fd) : alternarFonteAction(anterior, fd);
}

/**
 * "Habilitar todas desta página" (só administrador): tenta as desabilitadas SEM aviso de segurança, uma a uma, pelo mesmo caminho direto. As com
 * aviso ficam de fora (pedem confirmação). Volta à mesma busca e página com o resumo (é uma ação em lote: a lista precisa ser relida).
 */
export async function habilitarPaginaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin']);
  const ids = t(fd, 'ids').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const lista = await api.editorial.fontesRegistro();
  const q = t(fd, 'q');
  const pagina = t(fd, 'pagina');
  const estado = filtroEstado(t(fd, 'estado'));
  const base = new URLSearchParams({ ...(q ? { q } : {}), ...(estado ? { estado } : {}), ...(/^\d+$/.test(pagina) ? { pagina } : {}) });
  if (ehErro(lista)) {
    base.set('tipo', 'err');
    base.set('aviso', mensagemErro(lista));
    redirect(`/studio/fontes/fabrica?${base.toString()}`);
  }
  const porId = new Map((lista.body as { items: FonteFabrica[] }).items.map((f) => [f.id, f]));
  const alvo = elegiveisParaLote(ids.map((id) => porId.get(id)).filter((f): f is FonteFabrica => Boolean(f)));
  const comAviso = ids.filter((id) => (porId.get(id)?.riscos.length ?? 0) > 0 && !porId.get(id)?.habilitada).length;
  let habilitadas = 0;
  let recusadas = 0;
  for (const f of alvo) {
    const r = await api.editorial.habilitarFonte(f.id, true, { direto: true });
    if (ehErro(r)) recusadas++;
    else habilitadas++;
  }
  base.set('tipo', recusadas && !habilitadas ? 'err' : 'ok');
  base.set('aviso', resumoDoLote({ habilitadas, comAviso, recusadas }));
  redirect(`/studio/fontes/fabrica?${base.toString()}`);
}
