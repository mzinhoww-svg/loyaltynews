export const ACCOUNTS: readonly ['claude', 'codex', 'opencode'];
export const STAGES: readonly string[];
export const KINDS: readonly string[];
export class CliError extends Error {
  code: string;
  status?: number;
  /** Parar o ciclo e não repetir em laço (423 Locked; indisponibilidade da borda). */
  stop: boolean;
}
export interface CliIo {
  fetchImpl?: typeof fetch;
  now?: () => number;
  readFile?: (path: string, enc: 'utf8') => string;
}
export function sign(secret: string, timestampMs: number, raw: string): string;
/** Resultado JSON do comando (pull, input, result, done, limit, fail, heartbeat): a resposta da API do LN. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- o formato é o da resposta da API, conferido pelos testes
export function run(argv: string[], env: Record<string, string | undefined>, io?: CliIo): Promise<any>;
