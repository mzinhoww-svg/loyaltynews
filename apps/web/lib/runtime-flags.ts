// Flags de produto em runtime (ADR-022). Resolvidas uma vez na subida, em instrumentation-node.ts (N2);
// deps.ts, /api/health e o Studio leem o mesmo resultado memoizado. Só servidor: nunca NEXT_PUBLIC_ (N1).
import { resolveFlags, type FlagState, type FlagName, type ResolvedFlags } from '@ln/contracts';

let memo: ResolvedFlags | null = null;

/** Resolve e memoiza. Lança na configuração inválida (falha fechada). */
export function initRuntimeFlags(env: Record<string, string | undefined> = process.env): ResolvedFlags {
  memo = resolveFlags(env);
  return memo;
}

function current(): ResolvedFlags {
  return memo ?? initRuntimeFlags(process.env);
}

/** Estado completo das flags (cópia). */
export function runtimeFlags(): FlagState {
  return { ...current().state };
}

/** Nomes ligados, para /api/health (N8). */
export function runtimeFlagNames(): FlagName[] {
  return [...current().on];
}

export function resetRuntimeFlagsForTest(): void {
  memo = null;
}
