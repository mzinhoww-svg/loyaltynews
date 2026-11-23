'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { requireStudio } from '../../../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pagina = (pessoa: string, extra: Record<string, string>): string => `/studio/entidades/pessoa/${pessoa}?${new URLSearchParams(extra).toString()}`;
const idDe = (fd: FormData, k: string): string => {
  const v = t(fd, k);
  return UUID.test(v) ? v : '';
};

/** Abre o pedido do titular (acesso, retificação do nome ou remoção). Só o admin: a rota exige usuarios:update. A decisão e a trilha são do Backend. */
export async function abrirPedidoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin']);
  const pessoa = idDe(fd, 'pessoa');
  if (!pessoa) redirect('/studio/entidades?tipo=err&aviso=' + encodeURIComponent('Pessoa inválida.'));
  const kind = t(fd, 'kind');
  if (kind !== 'access' && kind !== 'rectification' && kind !== 'suppression') redirect(pagina(pessoa, { tipo: 'err', aviso: 'Escolha o tipo do pedido.' }));
  const note = t(fd, 'note');
  const r = await api.intelligence.abrirPedido({ personId: pessoa, kind: kind as 'access' | 'rectification' | 'suppression', ...(note ? { note } : {}) });
  if (ehErro(r)) redirect(pagina(pessoa, { tipo: 'err', aviso: mensagemErro(r) }));
  redirect(pagina(pessoa, { tipo: 'ok', aviso: 'Pedido aberto. Conclua abaixo.', pedido: r.body.id, kind }));
}

/** Acesso: devolve o que o sistema guarda da pessoa (nome, cargos, evidências) e encerra o pedido. */
export async function exportarPedidoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin']);
  const pessoa = idDe(fd, 'pessoa');
  const pedido = idDe(fd, 'pedido');
  if (!pessoa || !pedido) redirect('/studio/entidades?tipo=err&aviso=' + encodeURIComponent('Pedido inválido.'));
  const r = await api.intelligence.exportarPedido(pedido);
  if (ehErro(r)) redirect(pagina(pessoa, { tipo: 'err', aviso: mensagemErro(r), pedido, kind: 'access' }));
  redirect(pagina(pessoa, { tipo: 'ok', aviso: 'Pedido de acesso concluído: dados exportados abaixo.', exportado: pedido }));
}

/** Retificação do nome, a pedido do titular. O Backend recusa pedido que não é de retificação ou já encerrado. */
export async function retificarPedidoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin']);
  const pessoa = idDe(fd, 'pessoa');
  const pedido = idDe(fd, 'pedido');
  if (!pessoa || !pedido) redirect('/studio/entidades?tipo=err&aviso=' + encodeURIComponent('Pedido inválido.'));
  const r = await api.intelligence.retificarPedido(pedido, t(fd, 'fullName'));
  if (ehErro(r)) redirect(pagina(pessoa, { tipo: 'err', aviso: mensagemErro(r), pedido, kind: 'rectification' }));
  redirect(pagina(pessoa, { tipo: 'ok', aviso: 'Nome retificado. Pedido encerrado.' }));
}

/**
 * Remoção: a pessoa some do portal, de consultas, grafo, Moves e alertas, e a reingestão é bloqueada. Exige confirmação marcada.
 * O apagamento físico é decisão do controlador; os dados ficam inacessíveis.
 */
export async function removerPessoaAction(fd: FormData): Promise<void> {
  await requireStudio(['admin']);
  const pessoa = idDe(fd, 'pessoa');
  const pedido = idDe(fd, 'pedido');
  if (!pessoa || !pedido) redirect('/studio/entidades?tipo=err&aviso=' + encodeURIComponent('Pedido inválido.'));
  if (fd.get('confirmo') !== 'on') redirect(pagina(pessoa, { tipo: 'err', aviso: 'Marque a confirmação para remover a pessoa.', pedido, kind: 'suppression' }));
  const r = await api.intelligence.suprimirPedido(pedido);
  if (ehErro(r)) redirect(pagina(pessoa, { tipo: 'err', aviso: mensagemErro(r), pedido, kind: 'suppression' }));
  redirect('/studio/entidades?tipo=ok&aviso=' + encodeURIComponent('Pessoa removida: não aparece mais no portal, nas consultas, nos Moves nem nos alertas, e a reingestão está bloqueada.'));
}
