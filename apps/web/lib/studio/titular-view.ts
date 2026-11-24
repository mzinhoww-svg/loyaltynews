// Fila de pedidos do titular (DP-38, Studio 2): tipos do que /api/studio/correcoes devolve (ft/backend-2 39e958c) e regras de exibição.
// A decisão é REGISTRADA; o efeito na exibição pública ainda não existe (efeitoPublico: 'pendente'). A tela nunca diz "removido do portal".
// O prazo é INTERNO (15 dias corridos, proposta operacional; parecer jurídico R0-10 pendente), nunca "prazo legal".

export type EstadoPedido = 'recebido' | 'em_analise' | 'corrigido' | 'removido' | 'negado';
export type AcaoDecisao = 'corrigir' | 'remover_cargo' | 'remover_pessoa' | 'negar';
export interface AlvoPedido {
  tipo: 'pessoa' | 'cargo' | 'move';
  id: string;
  nome: string | null;
  empresa: string | null;
}
export interface PedidoLinha {
  id: string;
  recebido_em: string;
  prazo_em: string;
  estado: EstadoPedido;
  responsavel: string | null;
  alvo: AlvoPedido | null;
  pedido: 'correcao' | 'remocao';
  /** Texto livre (url, resumo, decisão): o Studio NÃO os exibe na lista (QA 7); o Backend 2 vai tirá-los da projeção da lista. */
  url?: string;
  resumo?: string;
  decisao?: unknown;
  decidido_por?: string;
  decidido_em?: string;
  /** 'pendente' até o Intelligence aplicar; 'aplicado' quando o portal já reflete a decisão (ft/backend 37dd430). */
  efeitoPublico?: 'pendente' | 'aplicado';
}
export interface EventoAuditoria {
  em: string;
  ator: string;
  acao: string;
  motivo: string | null;
}
export interface PedidoDetalhe extends PedidoLinha {
  url: string;
  texto: string;
  nome: string;
  contato: string;
  auditoria: EventoAuditoria[];
}

export const ESTADOS: EstadoPedido[] = ['recebido', 'em_analise', 'corrigido', 'removido', 'negado'];
export const ROTULO_ESTADO: Record<EstadoPedido, string> = {
  recebido: 'Recebido',
  em_analise: 'Em análise',
  corrigido: 'Corrigido (decisão registrada)',
  removido: 'Remoção decidida (decisão registrada)',
  negado: 'Negado',
};
export const ROTULO_PEDIDO: Record<PedidoLinha['pedido'], string> = { correcao: 'Correção', remocao: 'Remoção' };
export const ROTULO_ALVO: Record<AlvoPedido['tipo'], string> = { pessoa: 'Pessoa', cargo: 'Cargo', move: 'Move' };
export const ROTULO_ACAO: Record<AcaoDecisao, string> = {
  corrigir: 'Corrigir',
  remover_cargo: 'Remover o cargo da exibição',
  remover_pessoa: 'Remover a pessoa da exibição',
  negar: 'Negar',
};

export const aberto = (e: EstadoPedido): boolean => e === 'recebido' || e === 'em_analise';

/** Estado do filtro (?estado=): só os cinco válidos; qualquer outro valor = todos. */
export function estadoDoFiltro(v: string | undefined): EstadoPedido | undefined {
  return ESTADOS.includes(v as EstadoPedido) ? (v as EstadoPedido) : undefined;
}

export type SituacaoPrazo = 'vencido' | 'vence_logo' | 'no_prazo' | 'encerrado';
/** Situação do prazo interno: pedido decidido = encerrado; aberto vencido; vence em até 3 dias; no prazo. */
export function situacaoDoPrazo(p: Pick<PedidoLinha, 'prazo_em' | 'estado'>, agora: Date): SituacaoPrazo {
  if (!aberto(p.estado)) return 'encerrado';
  const falta = new Date(p.prazo_em).getTime() - agora.getTime();
  if (falta < 0) return 'vencido';
  if (falta <= 3 * 86_400_000) return 'vence_logo';
  return 'no_prazo';
}
export const ROTULO_PRAZO: Record<SituacaoPrazo, string> = {
  vencido: 'Prazo interno vencido',
  vence_logo: 'Vence em até 3 dias',
  no_prazo: 'No prazo interno',
  encerrado: 'Decidido',
};

/** Link para conferir o alvo no Studio (a página do executivo é da Studio 1). Cargo e Move não têm página própria: null. */
export function linkDoAlvo(a: AlvoPedido | null): string | null {
  return a && a.tipo === 'pessoa' ? `/studio/entidades/pessoa/${encodeURIComponent(a.id)}` : null;
}

/** Campos da correção a partir de pares (campo, valor) do formulário: ignora pares vazios; 1 a 20 campos; nome até 60. */
export function camposDaCorrecao(pares: [string, string][]): { ok: true; campos: Record<string, string> } | { ok: false; erro: string } {
  const campos: Record<string, string> = {};
  for (const [c, v] of pares) {
    const k = c.trim();
    if (!k && !v.trim()) continue;
    if (!k) return { ok: false, erro: 'Informe o nome do campo para cada valor corrigido.' };
    if (k.length > 60) return { ok: false, erro: 'Nome de campo com no máximo 60 caracteres.' };
    campos[k] = v.trim();
  }
  const n = Object.keys(campos).length;
  if (n < 1) return { ok: false, erro: 'Informe pelo menos um campo corrigido.' };
  if (n > 20) return { ok: false, erro: 'No máximo 20 campos por correção.' };
  return { ok: true, campos };
}

/** Rótulo legível da ação de auditoria (titular.pedido_atribuido → "pedido atribuido"). */
export const rotuloAcaoAuditoria = (a: string): string => a.replace(/^titular\./, '').replace(/_/g, ' ');
