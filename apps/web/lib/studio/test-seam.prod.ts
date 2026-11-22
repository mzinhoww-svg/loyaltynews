// Build de produção: não há sessão simulada. Este módulo é o alvo padrão do alias `@ln-studio/test-seam`.
import type { TestSeam } from './session';

export const testSeam: TestSeam | null = null;
