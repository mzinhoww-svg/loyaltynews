// Flags de produto no Studio (ADR-022): lidas SEMPRE pelo resolvedor de runtime (o mesmo da API e do /api/health), nunca por isEnabled direto,
// e só no servidor (N1: nunca NEXT_PUBLIC_). Quem chama precisa estar em página dinâmica (N9): todas as telas do Studio são force-dynamic.
import type { FlagName } from '@ln/contracts';
import { flagsE2e } from '@ln-studio/e2e-backend';
import { runtimeFlags } from '../runtime-flags';

// No build de e2e as flags mexidas pelos testes (as mesmas que as rotas enxergam) se somam ao resolvedor; em produção `flagsE2e` é nulo.
export const flagAtiva = (nome: FlagName): boolean => {
  const teste = flagsE2e?.();
  if (teste && nome in teste) return teste[nome] === true;
  return runtimeFlags()[nome] === true;
};
