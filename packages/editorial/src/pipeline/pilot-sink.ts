import type { TaskClass } from '../gateway';

/**
 * Linha do piloto (planilha de medição do AgentOps): a Editorial grava, por tarefa, o que SÓ ELA sabe depois do gate:
 * `gate_verdict`, `gate_reasons`, `cross_provider_ok` (checagem e revisão) e `output_valid` (formato da saída da classe).
 * O adaptador do OpenBot não vê o resultado do gate (ele roda depois do gateway), então a gravação é daqui.
 * Só os campos patcháveis da linha (PATCHABLE_ROW_FIELDS de @ln/agents); medição do adaptador nunca é tocada.
 * Gravar é MELHOR ESFORÇO: falha vira registro de auditoria e a linha fica pendente; nunca derruba nem muda o gate.
 */
export interface PilotRowPatch {
  gate_verdict?: 'approved' | 'blocked';
  gate_reasons?: string[];
  cross_provider_ok?: boolean;
  output_valid?: boolean;
}
export interface PilotRowSink {
  patch(p: { taskId: string; attempt: number; stage: TaskClass; patch: PilotRowPatch }): Promise<void>;
}

/** Contrato mínimo das duas peças de @ln/agents/Backend (injetadas; a Editorial não depende delas). */
export interface PilotRowLike { task_id: string; attempt: number; [k: string]: unknown }
export interface PilotRowStoreLike {
  all(): Promise<PilotRowLike[]>;
  patch(taskId: string, attempt: number, fields: Record<string, unknown>): Promise<boolean>;
}
export type ApplyRowPatch = (row: never, patch: Record<string, unknown>) => { row: unknown; errors: string[] };

/**
 * Sink real: confere o patch com `applyRowPatch` (AgentOps: recusa campo de medição e linha contraditória) contra a linha atual e só então
 * chama `rows.patch`. Linha ainda inexistente (o adaptador grava a linha ao concluir a tarefa) ou patch recusado lançam: o chamador registra.
 */
export function pilotRowSinkFrom(rows: PilotRowStoreLike, applyRowPatch: ApplyRowPatch): PilotRowSink {
  return {
    async patch({ taskId, attempt, patch }) {
      const row = (await rows.all()).find((r) => r.task_id === taskId && r.attempt === attempt);
      if (!row) throw new Error(`linha do piloto inexistente: ${taskId}#${attempt}`);
      const r = applyRowPatch(row as never, patch as Record<string, unknown>);
      if (r.errors.length) throw new Error(`patch recusado: ${r.errors.join('; ')}`);
      if (!(await rows.patch(taskId, attempt, patch as Record<string, unknown>))) throw new Error(`linha do piloto sumiu: ${taskId}#${attempt}`);
    },
  };
}
