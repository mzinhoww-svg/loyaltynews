'use server';

import { api, type CardPedido, type CardSocial } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { findModule } from '@/lib/studio/modules';
import { requireModule } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

const BASE = '/studio/creative';

/** Lê o pedido do formulário (matéria, template, formato, formato autoral). Validação e recusas são do Backend. */
const pedidoDoForm = async (fd: FormData): Promise<CardPedido> => {
  const autoral = texto(fd, 'autoral');
  return {
    articleId: texto(fd, 'artigo'),
    kind: texto(fd, 'kind') as CardPedido['kind'],
    format: texto(fd, 'formato') as CardPedido['format'],
    ...(autoral ? { autoralFormato: autoral as CardPedido['autoralFormato'] } : {}),
  };
};

/** Salva o card em rascunho (idempotente: o mesmo SVG da mesma matéria e formato devolve o card existente). Não publica nada. */
export async function criarCardAction(fd: FormData): Promise<void> {
  await requireModule(findModule('creative')!);
  const r = await api.creative.criar(await pedidoDoForm(fd));
  if (ehErro(r)) return voltar(BASE, { ok: false, erros: [mensagemErro(r)] }, '');
  voltar(BASE, { ok: true }, r.body.existente ? 'Este card já existia (mesmo SVG); nada foi duplicado.' : 'Card salvo em rascunho.');
}

/** Transição do card: enviar para revisão, aprovar, rejeitar (com motivo) ou voltar a rascunho. Papel e "quem criou não aprova" são do Backend. */
export async function transicaoCardAction(fd: FormData): Promise<void> {
  await requireModule(findModule('creative')!);
  const motivo = texto(fd, 'motivo');
  const para = texto(fd, 'para') as CardSocial['estado'];
  const r = await api.creative.transicao(texto(fd, 'id'), { para, ...(motivo ? { motivo } : {}) });
  voltar(BASE, ehErro(r) ? { ok: false, erros: [mensagemErro(r)] } : { ok: true }, `Card movido para ${para.replace('_', ' ')}.`);
}
