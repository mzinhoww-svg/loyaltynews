'use server';

// Pedidos do titular pelas rotas do Backend (/api/studio/correcoes): RBAC `titular`, atomicidade (409) e auditoria são da API.
import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { camposDaCorrecao, type AcaoDecisao } from '@/lib/studio/titular-view';
import { requireStudio } from '../../_lib/guard';
import { texto } from '../../_lib/flash';

const CHEFIA = ['admin', 'editor_chefe'] as const;
const ACOES: AcaoDecisao[] = ['corrigir', 'remover_cargo', 'remover_pessoa', 'negar'];

function voltar(id: string, ok: boolean, msg: string): never {
  const q = new URLSearchParams({ tipo: ok ? 'ok' : 'err', aviso: msg });
  const base = /^[0-9a-zA-Z-]{1,64}$/.test(id) ? `/studio/correcoes-titular/${id}` : '/studio/correcoes-titular';
  redirect(`${base}?${q.toString()}`);
}

/** Atribui o pedido a quem está logado (o Backend aceita só editor-chefe ou admin como responsável). */
export async function atribuirAMimAction(fd: FormData): Promise<void> {
  const { session } = await requireStudio(CHEFIA);
  const id = texto(fd, 'id');
  const r = await api.titular.atribuir(id, session.userId);
  voltar(id, !ehErro(r), ehErro(r) ? mensagemErro(r) : 'Pedido atribuído a você; agora está em análise.');
}

export async function decidirAction(fd: FormData): Promise<void> {
  await requireStudio(CHEFIA);
  const id = texto(fd, 'id');
  const acao = texto(fd, 'acao') as AcaoDecisao;
  if (!ACOES.includes(acao)) voltar(id, false, 'Ação inválida.');
  const motivo = texto(fd, 'motivo');
  if (acao === 'negar' && motivo.length < 5) voltar(id, false, 'Para negar, escreva o motivo (pelo menos 5 caracteres).');
  let campos: Record<string, string> | undefined;
  if (acao === 'corrigir') {
    const pares: [string, string][] = [0, 1, 2].map((i) => [texto(fd, `campo${i}`), texto(fd, `valor${i}`)]);
    const c = camposDaCorrecao(pares);
    if (!c.ok) voltar(id, false, c.erro);
    campos = c.campos;
  }
  if ((acao === 'remover_cargo' || acao === 'remover_pessoa') && texto(fd, 'confirmo') !== 'sim') voltar(id, false, 'Marque a confirmação para registrar a remoção.');
  const r = await api.titular.decidir(id, { acao, ...(campos ? { campos } : {}), ...(motivo ? { motivo } : {}) });
  voltar(
    id,
    !ehErro(r),
    ehErro(r)
      ? mensagemErro(r)
      : acao === 'negar'
        ? 'Pedido negado: decisão registrada e auditada, com o motivo. Nada muda na exibição pública.'
        : 'Decisão registrada e auditada. O efeito na exibição pública ainda está pendente: o portal não muda por esta tela.',
  );
}
