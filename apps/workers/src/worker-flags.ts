// Flags de produto no worker (ADR-022): o mesmo resolvedor puro do web (resolveFlags do @ln/contracts), resolvido UMA vez na subida.
// Configuração inválida (nome desconhecido, flag sem decisão para o ambiente) LANÇA: o worker não sobe com as flags
// desligadas por conta própria (falha fechada, como o web). A mensagem cita só o nome da flag e o ambiente, nunca o valor.
import { resolveFlags, type FlagName } from '@ln/contracts';

type Env = Record<string, string | undefined>;

/** Estado das flags na subida. Lança com a mensagem do resolvedor; quem chama encerra o processo com 1. */
export function resolveWorkerFlags(env: Env = process.env, log: (line: string) => void = (l) => console.error(l)): Record<FlagName, boolean> {
  const r = resolveFlags(env);
  for (const w of r.warnings) log(`[workers] ${w}`);
  return r.state;
}

/** Função de consulta usada pelos jobs. Configuração inválida lança (não devolve "tudo desligado"). */
export function workerFlagResolver(env: Env = process.env, log: (line: string) => void = (l) => console.error(l)): (f: FlagName) => boolean {
  const state = resolveWorkerFlags(env, log);
  return (f) => state[f] === true;
}
