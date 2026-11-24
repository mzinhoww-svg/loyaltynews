import type { CliIo } from './ln-openbot-agent.mjs';
export const FALSE_SECRET: string;
export interface Item11Options {
  fase: 'sem-segredo' | 'com-segredo';
  estado?: 'desligado' | 'ligado' | 'kill' | 'parado';
  /** Origem do staging (https://<staging>), sem /api/openbot. */
  base: string;
  account?: 'claude' | 'codex';
  /** Caminho do arquivo do cofre (só em com-segredo); o script NÃO o lê, quem lê é o cliente do agente. */
  secretFile?: string;
  confirmoDespachoDesligado?: boolean;
  confirmoFilaVazia?: boolean;
  /** Estado kill: o operador confirma que o kill switch está LIGADO (sem isso nada assinado é enviado). */
  confirmoKillLigado?: boolean;
  /** Estado parado: o operador confirma que o piloto está PARADO (sem isso nada assinado é enviado). */
  confirmoPilotoParado?: boolean;
}
export interface Item11Step {
  n: number;
  passo: string;
  esperado: string;
  observado: unknown;
  veredito: 'PASS' | 'FAIL' | 'WARN' | 'NAO_EXECUTADO';
  nota?: string;
}
export interface Item11Result {
  ok: boolean;
  fase: string;
  estado?: string;
  url: string;
  quando: string;
  passos: Item11Step[];
  recusado?: string;
  servidorSemSegredo?: string;
}
export function runItem11(opts: Item11Options, io?: CliIo): Promise<Item11Result>;
export function toText(r: Item11Result): string;
