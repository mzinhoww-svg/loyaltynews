import { describe, expect, it } from 'vitest';
import { escalationAllocationUsd } from './policy-compat';

describe('compatibilidade do sublimite de escalonamento entre versões da política', () => {
  it('lê o nome da v6/v7, o da v5 e devolve 0 sem nenhum', () => {
    expect(escalationAllocationUsd({ anthropic_escalation_opus_included: 5 })).toBe(5);
    expect(escalationAllocationUsd({ anthropic_escalation_opus_fable_included: 4 })).toBe(4);
    expect(escalationAllocationUsd({ anthropic_escalation_opus_included: 5, anthropic_escalation_opus_fable_included: 4 })).toBe(5);
    expect(escalationAllocationUsd({})).toBe(0);
  });
});
