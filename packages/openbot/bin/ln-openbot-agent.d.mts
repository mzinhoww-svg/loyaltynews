export const ACCOUNTS: readonly ['claude', 'codex'];
export const STAGES: readonly string[];
export class CliError extends Error {
  code: string;
  status?: number;
}
export interface CliIo {
  fetchImpl?: typeof fetch;
  now?: () => number;
  readFile?: (path: string, enc: 'utf8') => string;
}
export function sign(secret: string, timestampMs: number, raw: string): string;
export function run(argv: string[], env: Record<string, string | undefined>, io?: CliIo): Promise<any>;
