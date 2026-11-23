// Build de produção: não há banco em memória. Alvo padrão do alias `@ln-studio/dev-db`.
import type { FabricaDev } from './intelligence-db-core';

export const devDb: FabricaDev | null = null;
