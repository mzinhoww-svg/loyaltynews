// Exclusão de contato (lead) no CRM, pela rota DELETE /api/commercial/studio/leads/{id} (LGPD). Regras da tela:
//  - sem confirmação nada é chamado;
//  - só há sucesso com o 204 da rota: qualquer outra resposta diz que não foi excluído ou que a exclusão não está confirmada;
//  - o id de um lead pode ser reaproveitado depois de uma exclusão, então a confirmação leva a data de criação e é recusada se o
//    registro daquele id mudou (assim um pedido antigo não apaga outra pessoa);
//  - as mensagens voltam na URL (Flash): nunca levam nome, e-mail nem outro dado pessoal.
import { ehErro, mensagemErro, type ErroApi, type RespostaApi } from './backend';

export interface PedidoExclusao {
  id: string;
  /** Data de criação do registro mostrado na confirmação. */
  criadoEm: string;
  /** Vale só 'sim', enviado pelo botão da confirmação. */
  confirmar: string;
}

export interface RotasExclusao {
  leads: () => Promise<RespostaApi>;
  excluir: (leadId: string) => Promise<RespostaApi>;
}

export type ResultadoExclusao = { ok: boolean; mensagem: string };

export const EXCLUIDO = 'Contato excluído do CRM. Ficou o registro de quem excluiu e quando, sem os dados da pessoa.';
export const NAO_CONFIRMADA = 'Exclusão não confirmada. Nada foi apagado.';
export const MUDOU = 'O contato mudou ou já não existe desde que a confirmação foi aberta. Nada foi apagado: confira a lista e peça a exclusão de novo.';
export const SEM_CONFIGURACAO =
  'O contato NÃO foi excluído: a exclusão não está configurada neste ambiente (falta a configuração da trilha de auditoria). Avise quem opera o ambiente. Código: LEAD_AUDIT_NOT_CONFIGURED.';
export const NAO_ENCONTRADO = 'Contato não encontrado: ele já não está no CRM. Esta tentativa não apagou nada.';

const falha = (mensagem: string): ResultadoExclusao => ({ ok: false, mensagem });

/** Resposta da rota de exclusão → o que a tela pode afirmar. */
export function interpretarExclusao(r: RespostaApi): ResultadoExclusao {
  if (r.status === 204) return { ok: true, mensagem: EXCLUIDO };
  const codigo = (r.body as ErroApi | null)?.error?.code;
  if (codigo === 'LEAD_AUDIT_NOT_CONFIGURED') return falha(SEM_CONFIGURACAO);
  if (r.status === 404) return falha(NAO_ENCONTRADO);
  // 4xx: a rota recusou antes de apagar
  if (r.status >= 400 && r.status < 500) return falha(`O contato NÃO foi excluído: ${mensagemErro(r)}`);
  // qualquer outra resposta (500 genérico, 503, 2xx inesperado) não prova nem que apagou nem que não apagou
  const motivo = ehErro(r) ? mensagemErro(r) : `Resposta inesperada (${r.status}).`;
  return falha(`A exclusão não foi confirmada: ${motivo} Confira na lista se o contato ainda está lá antes de tentar de novo.`);
}

export async function executarExclusao(pedido: PedidoExclusao, rotas: RotasExclusao): Promise<ResultadoExclusao> {
  if (pedido.confirmar !== 'sim' || !pedido.id || !pedido.criadoEm) return falha(NAO_CONFIRMADA);
  const lista = await rotas.leads();
  if (ehErro(lista)) return falha(`Nada foi apagado: não foi possível conferir o contato antes de excluir. ${mensagemErro(lista)}`);
  const atual = (lista.body as { id: string; createdAt: string }[]).find((l) => l.id === pedido.id);
  if (!atual || atual.createdAt !== pedido.criadoEm) return falha(MUDOU);
  return interpretarExclusao(await rotas.excluir(pedido.id));
}
