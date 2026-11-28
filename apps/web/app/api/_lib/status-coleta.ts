// GET /api/status/coleta: rota PÚBLICA para o vigia externo. Responde só { estado, ultimaRodadaBoaEm }: 200 em 'ok'; 503 em
// 'atrasada', 'nunca' e 'indisponivel'. Sem fonte, erro, host, contagem ou flag. A leitura do banco é uma consulta filtrada de uma
// linha, guardada em memória por pouco tempo (também a falha), para a rota pública não virar carga no banco.
import { collectionStatus, type CollectionStatus } from '@ln/editorial';
import { errLine } from '@ln/db/safe-log';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import type { Db } from '@ln/auth';
import type { Deps } from './deps';

export const CACHE_MS = 60_000;
export const CACHE_FALHA_MS = 10_000;
export const PRAZO_DA_CONSULTA_MS = 2_000;

type Guardado = { db: Db; ate: number; valor: Promise<string | null> };
let guardado: Guardado | null = null;
export function limparCacheDaColetaParaTeste(): void {
  guardado = null;
}

function comPrazo<T>(p: Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, recusa) => { t = setTimeout(() => recusa(new Error('prazo da consulta')), PRAZO_DA_CONSULTA_MS); });
  return Promise.race([p, prazo]).finally(() => clearTimeout(t));
}

const responder = (corpo: CollectionStatus | { estado: 'indisponivel'; ultimaRodadaBoaEm: null }) =>
  Response.json(corpo, { status: corpo.estado === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } });

export async function statusDaColeta(deps: Deps | null): Promise<Response> {
  if (!deps) return responder({ estado: 'indisponivel', ultimaRodadaBoaEm: null });
  const agora = deps.now();
  const t = agora.getTime();
  if (!guardado || guardado.db !== deps.db || t >= guardado.ate) {
    const novo: Guardado = { db: deps.db, ate: t + CACHE_MS, valor: comPrazo(new PgEditorialStore(deps.db).lastGoodRoundAt()) };
    // uma linha de log por consulta que falha (não por pedido); a mensagem do driver não vai para a resposta
    novo.valor.catch((e: unknown) => { novo.ate = t + CACHE_FALHA_MS; console.error(errLine('[status] leitura da coleta falhou', e)); });
    guardado = novo;
  }
  try {
    return responder(collectionStatus(await guardado.valor, agora));
  } catch {
    return responder({ estado: 'indisponivel', ultimaRodadaBoaEm: null });
  }
}
