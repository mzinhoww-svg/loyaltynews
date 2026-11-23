/**
 * Compatibilidade entre versões da política de modelos: a v5 chama o sublimite de escalonamento de
 * `anthropic_escalation_opus_fable_included`; a v6 e a v7 de `anthropic_escalation_opus_included` (só Opus). Lê qualquer um,
 * seja qual for a versão do tipo em `@ln/modelops` (o campo pode ser obrigatório ou opcional conforme a branch).
 */
export function escalationAllocationUsd(alloc: object): number {
  const a = alloc as { anthropic_escalation_opus_included?: number; anthropic_escalation_opus_fable_included?: number };
  return a.anthropic_escalation_opus_included ?? a.anthropic_escalation_opus_fable_included ?? 0;
}
