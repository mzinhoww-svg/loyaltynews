// Build de produção: não há backend de e2e. Alvo padrão do alias `@ln-studio/e2e-backend`.
import type { FabricaE2eBackend } from './e2e-backend.types';

export const e2eBackend: FabricaE2eBackend | null = null;
export const sincronizarFlagsE2e: (() => void) | null = null;
