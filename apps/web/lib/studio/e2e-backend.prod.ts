// Build de produção: não há backend de e2e. Alvo padrão do alias `@ln-studio/e2e-backend`.
import type { FabricaE2eBackend } from './e2e-backend.types';

export const e2eBackend: FabricaE2eBackend | null = null;
export const sincronizarFlagsE2e: (() => void) | null = null;
/** Flags alteradas pelos testes (só no build de e2e). Em produção não existe: o Studio lê só o resolvedor de runtime (ADR-022). */
export const flagsE2e: (() => Record<string, boolean>) | null = null;
