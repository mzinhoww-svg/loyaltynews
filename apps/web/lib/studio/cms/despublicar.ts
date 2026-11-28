// Despublicar matéria no CMS, pela rota que já existe (POST /api/materias/{id}/transicao, para = despublicado). Regras da tela:
//  - sem confirmação, sem nota válida ou sem a versão vista, nada é enviado;
//  - a versão vai junto: se a matéria mudou desde a confirmação, a rota recusa;
//  - só há sucesso quando a rota devolve a matéria despublicada; recusa diz que NÃO despublicou; o resto diz que não dá para confirmar;
//  - as mensagens voltam na URL (Flash): nunca levam a nota digitada.
// As regras ficam aqui, sem importar a tela, para os testes rodarem contra a rota real.
import type { Role } from '@ln/auth';
import { ehErro, mensagemErro, type RespostaApi } from '../backend';

/** Os mesmos limites da rota (ArticleTransition.nota). */
export const NOTA_MIN = 3;
export const NOTA_MAX = 1000;
/** Quem a rota deixa despublicar: materias:transition e materias:publish. */
export const PAPEIS_DESPUBLICAR: readonly Role[] = ['admin', 'editor_chefe'];
/** Estados que o contrato deixa ir para despublicado. */
export const ESTADOS_DESPUBLICAVEIS: readonly string[] = ['publicado', 'corrigido'];

export const DESPUBLICADA = 'Matéria despublicada. Ela deixou as rotas públicas; cópias em cache podem levar alguns minutos para sumir.';
export const NAO_CONFIRMADA = 'Confirmação ausente. A matéria NÃO foi despublicada.';
export const NOTA_INVALIDA = `Informe a nota da despublicação (de ${NOTA_MIN} a ${NOTA_MAX} caracteres). A matéria NÃO foi despublicada.`;
export const SEM_VERSAO = 'A tela não informou a versão da matéria. Recarregue e tente de novo. A matéria NÃO foi despublicada.';

export interface PedidoDespublicar {
  confirmar: string;
  nota: string;
  versao: number;
}
export type ResultadoDespublicar = { ok: boolean; mensagem: string };
export type TransicaoDespublicar = (corpo: { para: 'despublicado'; nota: string; versaoEsperada: number }) => Promise<RespostaApi>;

const falha = (mensagem: string): ResultadoDespublicar => ({ ok: false, mensagem });

export function interpretarDespublicacao(r: RespostaApi): ResultadoDespublicar {
  if (r.status === 200 && (r.body as { data?: { status?: unknown } } | null)?.data?.status === 'despublicado') return { ok: true, mensagem: DESPUBLICADA };
  if (ehErro(r) && r.status < 500) return falha(`A matéria NÃO foi despublicada: ${mensagemErro(r)}`);
  const motivo = ehErro(r) ? mensagemErro(r) : `Resposta inesperada (${r.status}).`;
  return falha(`Não foi possível confirmar se a matéria foi despublicada: ${motivo} Confira o estado da matéria antes de tentar de novo.`);
}

export async function executarDespublicacao(pedido: PedidoDespublicar, transicionar: TransicaoDespublicar): Promise<ResultadoDespublicar> {
  if (pedido.confirmar !== 'sim') return falha(NAO_CONFIRMADA);
  const nota = pedido.nota.trim();
  if (nota.length < NOTA_MIN || nota.length > NOTA_MAX) return falha(NOTA_INVALIDA);
  if (!Number.isInteger(pedido.versao) || pedido.versao < 1) return falha(SEM_VERSAO);
  return interpretarDespublicacao(await transicionar({ para: 'despublicado', nota, versaoEsperada: pedido.versao }));
}
