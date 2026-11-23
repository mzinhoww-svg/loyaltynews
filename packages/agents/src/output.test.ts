import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { emptyOutputFor, validateAgentOutput } from './output';

const { agents } = loadRegistries();

describe('R4-04: saída fora do esquema é rejeitada (por perfil)', () => {
  it.each(agents.map((a) => [a.id, a] as const))('%s: aceita saída mínima e rejeita variações inválidas', (_id, a) => {
    expect(validateAgentOutput(a, emptyOutputFor(a))).toEqual({ ok: true, errors: [] });

    const base = emptyOutputFor(a);
    const bad = (mutate: (o: Record<string, unknown>) => void) => {
      const o = structuredClone(base);
      mutate(o);
      return validateAgentOutput(a, o);
    };
    expect(bad((o) => { o.agent_id = 'outro_perfil'; }).ok).toBe(false);
    expect(bad((o) => { o.artifact_type = 'x.result'; }).ok).toBe(false);
    expect(bad((o) => { delete o.confidence; }).ok).toBe(false);
    expect(bad((o) => { o.confidence = 1.5; }).ok).toBe(false);
    expect(bad((o) => { o.extra = 1; }).ok).toBe(false);
    expect(bad((o) => { (o.result as Record<string, unknown>).intruso = 1; }).ok).toBe(false);
    const firstField = a.required_result_fields[0]!;
    expect(bad((o) => { delete (o.result as Record<string, unknown>)[firstField]; }).ok).toBe(false);
    expect(validateAgentOutput(a, 'texto livre').ok).toBe(false);
    expect(validateAgentOutput(a, null).ok).toBe(false);
  });

  it('a saída válida de um perfil não é válida para outro (contratos diferenciados)', () => {
    const w = agents.find((a) => a.id === 'writer_mercado')!;
    const e = agents.find((a) => a.id === 'editor_mercado')!;
    expect(validateAgentOutput(e, emptyOutputFor(w)).ok).toBe(false);
  });
});
