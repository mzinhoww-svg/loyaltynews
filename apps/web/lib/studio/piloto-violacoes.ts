// Violações do piloto (paradas imediatas) e a resolução pelo admin (Studio 2; decisão PM-2026-11-23-D). Contrato do Backend 1 (ft/backend 0d886d9):
// POST /api/studio/openbot/pilot/rows/:taskId/:attempt/resolve { motivo 10–500, acaoTomada 1–200 } — só admin, auditada; NÃO apaga a linha;
// a violação continua contando no critério de 0 violações; a retomada passa a ignorar só as tratadas. Segredo em log exige acaoTomada=segredo_rotacionado.
import type { LinhaPiloto } from './piloto-planilha';

export type Violacao = 'published_attempt' | 'tarifada_api_call' | 'secret_in_log' | 'tool_outside_contract';
export const ROTULO_VIOLACAO: Record<Violacao, string> = {
  published_attempt: 'Tentativa de publicar',
  tarifada_api_call: 'Chamada à API tarifada',
  secret_in_log: 'Segredo em log',
  tool_outside_contract: 'Ferramenta fora do contrato',
};
/** Ações sugeridas (o Backend aceita texto livre de 1 a 200; "segredo_rotacionado" é obrigatória para segredo em log). */
export const ACOES = ['segredo_rotacionado', 'despacho_bloqueado', 'agente_corrigido', 'falso_positivo_conferido'] as const;
export const ROTULO_ACAO: Record<(typeof ACOES)[number], string> = {
  segredo_rotacionado: 'Segredo rotacionado',
  despacho_bloqueado: 'Despacho bloqueado até a correção',
  agente_corrigido: 'Agente ou contrato corrigido',
  falso_positivo_conferido: 'Falso positivo conferido',
};

export type Tratada = { por: string; em: string; motivo: string; acao: string };
export type LinhaComTratamento = LinhaPiloto & { tratada?: Tratada };

/** Mesma regra do Backend (violationsOf): as quatro paradas imediatas da planilha do AgentOps. */
export function violacoesDa(r: Record<string, unknown>): Violacao[] {
  return (['published_attempt', 'tarifada_api_call', 'secret_in_log', 'tool_outside_contract'] as const).filter((k) => r[k] === true);
}

/** Validação local antes de chamar a rota (o Backend valida de novo). Devolve o motivo do erro ou null. */
export function erroDaResolucao(linha: Record<string, unknown>, motivo: string, acao: string): string | null {
  if (violacoesDa(linha).length === 0) return 'Esta linha não tem parada imediata: não há o que resolver aqui.';
  const m = motivo.trim();
  if (m.length < 10 || m.length > 500) return 'Descreva o motivo em 10 a 500 caracteres.';
  const a = acao.trim();
  if (!a || a.length > 200) return 'Escolha ou descreva a ação tomada (até 200 caracteres).';
  if (linha.secret_in_log === true && a !== 'segredo_rotacionado') return 'Segredo em log só se resolve com o segredo rotacionado.';
  return null;
}
