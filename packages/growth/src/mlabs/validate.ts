import { readOnlyTransport, type McpTransport } from './live.ts';

// Validação de capacidades do mLabs SOMENTE por ferramentas de leitura (R1-05). Registra a FORMA das respostas
// (tipo, tamanho, nomes de campos), nunca valores: a saída pode ir para o repositório sem dados da conta.

export const VALIDATION_PLAN: { tool: string; args: Record<string, unknown>; answers: string }[] = [
  { tool: 'list_channels', args: {}, answers: 'canais conectados (LinkedIn presente? página/perfil?)' },
  { tool: 'get_post_limits', args: {}, answers: 'limites de caracteres, mídia, agendamento por rede' },
  { tool: 'list_templates', args: {}, answers: 'modelos de post disponíveis' },
  { tool: 'list_profiles', args: {}, answers: 'perfis da conta' },
  { tool: 'get_account_settings', args: {}, answers: 'plano e configurações da conta (sem segredos)' },
  { tool: 'list_scheduled_posts', args: {}, answers: 'se a leitura de agenda funciona (sem criar nada)' },
];

export interface Shape {
  type: string;
  length?: number;
  keys?: string[];
}

export interface CheckResult {
  tool: string;
  ok: boolean;
  shape?: Shape;
  error?: string;
  answers: string;
}

export interface ValidationReport {
  runAt: string;
  mode: 'read_only';
  results: CheckResult[];
  /** Tudo que a leitura NÃO consegue provar (menção, edição, exclusão, documento/PDF, uso sem chat). */
  notProvableByReads: string[];
}

export function shapeOf(v: unknown): Shape {
  if (Array.isArray(v)) {
    const first = v[0];
    return {
      type: 'array',
      length: v.length,
      keys: first && typeof first === 'object' ? Object.keys(first as object).sort() : undefined,
    };
  }
  if (v && typeof v === 'object') return { type: 'object', keys: Object.keys(v as object).sort() };
  return { type: v === null ? 'null' : typeof v };
}

export const NOT_PROVABLE_BY_READS = [
  'menção a empresa/pessoa em texto de post (precisa de teste de escrita em página de teste: R5-02)',
  'edição de post agendado (update_post)',
  'exclusão de post agendado/publicado (delete_post / delete_published_post)',
  'carrossel como documento/PDF no LinkedIn (upload_media com PDF)',
  'uso sem sessão interativa por 7 dias',
  'idempotência de create_post (reenvio) no lado do mLabs',
];

export async function validateMlabsReadOnly(
  transport: McpTransport,
  now: () => string = () => new Date().toISOString(),
): Promise<ValidationReport> {
  const ro = readOnlyTransport(transport);
  const results: CheckResult[] = [];
  for (const step of VALIDATION_PLAN) {
    try {
      const raw = await ro.call(step.tool, step.args);
      results.push({ tool: step.tool, ok: true, shape: shapeOf(raw), answers: step.answers });
    } catch (e) {
      results.push({ tool: step.tool, ok: false, error: String((e as Error).message).slice(0, 200), answers: step.answers });
    }
  }
  return { runAt: now(), mode: 'read_only', results, notProvableByReads: NOT_PROVABLE_BY_READS };
}
