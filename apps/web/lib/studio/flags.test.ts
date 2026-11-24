import { beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-022: o Studio lê flag SÓ pelo resolvedor de runtime (runtimeFlags). Em produção não há flags de teste (flagsE2e é nulo).
const estado: Record<string, boolean> = {};
let teste: Record<string, boolean> | null = null;
vi.mock('../runtime-flags', () => ({ runtimeFlags: () => ({ ...estado }) }));
vi.mock('@ln-studio/e2e-backend', () => ({ flagsE2e: () => teste }));

import { flagAtiva } from './flags';

beforeEach(() => {
  for (const k of Object.keys(estado)) delete estado[k];
  teste = null;
});

describe('flagAtiva', () => {
  it('desligada por padrão e ligada só quando o resolvedor a liga', () => {
    expect(flagAtiva('intelligencePessoas')).toBe(false);
    estado.intelligencePessoas = true;
    expect(flagAtiva('intelligencePessoas')).toBe(true);
    expect(flagAtiva('publicacaoPortal')).toBe(false);
  });
  it('flag de teste (só no build de e2e) vale sobre o resolvedor, nos dois sentidos', () => {
    estado.publicacaoPortal = false;
    teste = { publicacaoPortal: true };
    expect(flagAtiva('publicacaoPortal')).toBe(true);
    estado.intelligencePessoas = true;
    teste = { intelligencePessoas: false };
    expect(flagAtiva('intelligencePessoas')).toBe(false);
  });
  it('sem flag de teste para esse nome, vale o resolvedor', () => {
    estado.rituais = true;
    teste = { publicacaoPortal: true };
    expect(flagAtiva('rituais')).toBe(true);
  });
});

// A trava estática "o Studio não lê flag por isEnabled" fica em trava-adr022.test.ts (cobre app/studio e lib/studio, com ocorrência plantada).
