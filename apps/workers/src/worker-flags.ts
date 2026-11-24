// Flags de produto no worker (ADR-022): o mesmo resolvedor puro do web (resolveFlags do @ln/contracts), resolvido UMA vez na subida.
// Configuração inválida (nome desconhecido, flag sem decisão para o ambiente): log saneado e TODAS as flags desligadas (falha fechada;
// o web recusa a subida com a mesma mensagem, então o pacote não chega a operar assim).
import { resolveFlags, type FlagName } from '@ln/contracts';
import { errLine } from '@ln/db/safe-log';

type Env = Record<string, string | undefined>;

export function workerFlagResolver(env: Env = process.env, log: (line: string) => void = (l) => console.error(l)): (f: FlagName) => boolean {
  let state: Record<FlagName, boolean> | null = null;
  try {
    const r = resolveFlags(env);
    state = r.state;
    for (const w of r.warnings) log(`[workers] ${w}`);
  } catch (e) {
    log(errLine('[workers] flags desligadas: configuração inválida (ADR-022)', e));
  }
  return (f) => state?.[f] === true;
}
