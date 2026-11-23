/**
 * Validação da saída de um perfil contra o seu `output_contract` (ADR-004 / R4-04):
 * saída fora do esquema é rejeitada. Implementa exatamente o subconjunto de JSON Schema usado
 * pelos contratos (objeto estrito, const, required, number com limites, arrays de string).
 */
import type { AgentProfile } from './schemas';

export interface OutputCheck {
  ok: boolean;
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateAgentOutput(profile: AgentProfile, output: unknown): OutputCheck {
  const errors: string[] = [];
  const c = profile.output_contract;
  if (!isObj(output)) return { ok: false, errors: ['saída deve ser um objeto'] };

  for (const k of c.required) if (!(k in output)) errors.push(`campo obrigatório ausente: ${k}`);
  for (const k of Object.keys(output)) if (!(k in c.properties)) errors.push(`campo não permitido: ${k}`);

  if (output.agent_id !== c.properties.agent_id.const) errors.push(`agent_id deve ser ${c.properties.agent_id.const}`);
  if (output.artifact_type !== c.properties.artifact_type.const) errors.push(`artifact_type deve ser ${c.properties.artifact_type.const}`);

  const result = output.result;
  const rc = c.properties.result;
  if (!isObj(result)) errors.push('result deve ser um objeto');
  else {
    for (const k of rc.required) if (!(k in result)) errors.push(`result.${k} ausente`);
    for (const k of Object.keys(result)) if (!(k in rc.properties)) errors.push(`result.${k} não permitido`);
  }

  if ('evidence_refs' in output) {
    if (!Array.isArray(output.evidence_refs) || output.evidence_refs.some((x) => typeof x !== 'string')) errors.push('evidence_refs deve ser array de strings');
  }
  if ('blockers' in output) {
    if (!Array.isArray(output.blockers) || output.blockers.some((x) => typeof x !== 'string')) errors.push('blockers deve ser array de strings');
  }
  if ('confidence' in output) {
    const v = output.confidence;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) errors.push('confidence deve ser número entre 0 e 1');
  }
  if ('kpi_observations' in output && !isObj(output.kpi_observations)) errors.push('kpi_observations deve ser objeto');

  return { ok: errors.length === 0, errors };
}

/** Saída mínima válida de um perfil (usada em testes e como gabarito do adaptador R4-04). */
export function emptyOutputFor(profile: AgentProfile): Record<string, unknown> {
  return {
    agent_id: profile.id,
    artifact_type: `${profile.id}.result`,
    result: Object.fromEntries(profile.required_result_fields.map((f) => [f, null])),
    evidence_refs: [],
    confidence: 0,
    blockers: [],
    kpi_observations: {},
  };
}
