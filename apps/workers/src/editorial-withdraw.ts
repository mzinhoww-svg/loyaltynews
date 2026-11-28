// Pedido de retirada de conteúdo coletado (parecer 64): argumentos e execução do comando `editorial-withdraw.main.ts`.
import { withdrawCollected, type EditorialStore } from '@ln/editorial';

export interface WithdrawArgs { what: { sourceId: string } | { url: string }; confirm: boolean; environment: 'staging' | 'production' }

export const WITHDRAW_USAGE = 'uso: editorial-withdraw --ambiente staging|production (--fonte <id> | --url <endereço https>) [--confirmar]; sem --confirmar só conta';

/** Exatamente um alvo, sem argumento desconhecido: na dúvida, recusa (o comando apaga dado). */
export function parseWithdrawArgs(argv: readonly string[]): WithdrawArgs | null {
  let sourceId: string | undefined;
  let url: string | undefined;
  let confirm = false;
  let environment: WithdrawArgs['environment'] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--confirmar') confirm = true;
    else if (a === '--ambiente' && environment === undefined && (argv[i + 1] === 'staging' || argv[i + 1] === 'production')) environment = argv[++i] as WithdrawArgs['environment'];
    else if (a === '--fonte' && sourceId === undefined && /^[a-z0-9][a-z0-9-]*$/.test(argv[i + 1] ?? '')) sourceId = argv[++i]!;
    else if (a === '--url' && url === undefined && /^https:\/\/\S+$/.test(argv[i + 1] ?? '')) url = argv[++i]!;
    else return null;
  }
  if (environment === undefined || (sourceId === undefined) === (url === undefined)) return null;
  return { what: sourceId !== undefined ? { sourceId } : { url: url! }, confirm, environment };
}

export async function runWithdraw(store: EditorialStore, a: WithdrawArgs, now: Date): Promise<string> {
  const n = await withdrawCollected(store, now, a.what, { dryRun: !a.confirm });
  if (n === 0) return 'nada casou com o alvo na caixa de pautas: confira a fonte ou o endereço (matéria já redigida não entra); nada foi apagado';
  return a.confirm ? `retirada feita: ${n} item(ns) da caixa de pautas sem texto, título e autor` : `simulação: ${n} item(ns) seriam apagados; repita com --confirmar`;
}
