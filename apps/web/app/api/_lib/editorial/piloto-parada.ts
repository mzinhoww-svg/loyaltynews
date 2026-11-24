// Parada do piloto no 1º fato ALTO (critério 2 do PM, 24/11): a leitura do leitor 1 (editor-chefe) vai para a LINHA do piloto no banco, não só para o CSV.
// Fluxo: o handler da Editorial (registerLeitura) grava a leitura; se foi do leitor 1 (201), esta camada grava unsupported_* na(s) linha(s) final(is) da
// matéria (stage review ou check_edit; sem elas, a última linha do artigo) com applyRowPatch (validação do AgentOps) e PgPilotRowStore.patch, na MESMA
// transação. Daí em diante o canDispatchNext do kit (highFactOf em stopReasonsOf) recusa o próximo pull. Nada é apagado; leitor 2 não mexe na linha.
// Falha ao gravar NÃO desfaz a leitura (ela é imutável e já foi auditada): volta em `planilha.erros`, e a tela avisa que o despacho pode não parar.
import { applyRowPatch, highFactOf } from '@ln/agents';
import type { PilotRow } from '@ln/openbot'; // o tipo que o PgPilotRowStore grava e devolve (mesmos campos do PilotRow do AgentOps)
import { PgPilotRowStore } from '@ln/workers/openbot-pg';
import { listPiloto, registerLeitura, type ApiResponse } from '@ln/editorial';
import type { PublicationCtx } from './publication';

const FINAIS = new Set(['review', 'check_edit']);

export interface PlanilhaDaLeitura {
  /** task_id#attempt das linhas atualizadas. */
  linhas: string[];
  /** true quando a leitura tem fato ALTO (ou sem gravidade): o despacho do piloto para no próximo pull. */
  parada: boolean;
  erros: string[];
  aviso?: string;
}

type Contagens = { unsupportedFacts: number; altas: number; medias: number; baixas: number };

/** Linhas que recebem a leitura: as finais da matéria; sem elas, a última linha do artigo. */
export function linhasDaMateria(rows: readonly PilotRow[], articleId: string): PilotRow[] {
  const doArtigo = rows.filter((r) => r.article_id === articleId);
  const finais = doArtigo.filter((r) => FINAIS.has(r.stage));
  if (finais.length) return finais;
  const ultima = [...doArtigo].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
  return ultima ? [ultima] : [];
}

export async function gravarLeituraNaLinha(db: PublicationCtx['db'], now: () => Date, articleId: string, c: Contagens): Promise<PlanilhaDaLeitura> {
  const patch = { unsupported_facts: c.unsupportedFacts, unsupported_high: c.altas, unsupported_medium: c.medias, unsupported_low: c.baixas };
  const parada = highFactOf(patch);
  const store = new PgPilotRowStore(db as never, now);
  const alvo = linhasDaMateria(await store.all(), articleId);
  if (!alvo.length) return { linhas: [], parada, erros: [], aviso: 'nenhuma linha do piloto para este artigo ainda: a leitura vale para a planilha quando a linha existir' };
  const linhas: string[] = [];
  const erros: string[] = [];
  for (const row of alvo) {
    const id = `${row.task_id}#${row.attempt}`;
    const ap = applyRowPatch(row as unknown as Parameters<typeof applyRowPatch>[0], patch);
    if (ap.errors.length) {
      erros.push(`${id}: ${ap.errors.join('; ')}`);
      continue;
    }
    if (await store.patch(row.task_id, row.attempt, patch)) linhas.push(id);
    else erros.push(`${id}: linha não encontrada ao gravar`);
  }
  return { linhas, parada, erros };
}

/** POST /piloto/:materia/leitura com a gravação da leitura do leitor 1 na linha do piloto. */
export async function registerLeituraComParada(ctx: PublicationCtx, input: unknown): Promise<ApiResponse<unknown>> {
  const r = await registerLeitura(ctx as never, input);
  if (r.status !== 201) return r;
  const b = r.body as Contagens & { materia: string; leitor: 1 | 2 };
  if (b.leitor !== 1) return r;
  const lista = await listPiloto(ctx as never, {});
  const articleId = 'items' in (lista.body as object) ? (lista.body as { items: { materia: string; articleId: string | null }[] }).items.find((i) => i.materia === b.materia)?.articleId : null;
  if (!articleId) return { status: 201, body: { ...b, planilha: { linhas: [], parada: highFactOf({ unsupported_facts: b.unsupportedFacts, unsupported_high: b.altas, unsupported_medium: b.medias, unsupported_low: b.baixas }), erros: ['matéria sem artigo no mapa'] } } };
  // A rota POST já roda dentro de db.transaction (index.ts, com trava consultiva). A gravação na linha fica num savepoint próprio: se o banco falhar
  // aqui, só o savepoint volta, a leitura (já registrada e auditada) fica, e a falha vai em planilha.erros em vez de virar 500 (ressalva 3 do QA 9).
  let planilha: PlanilhaDaLeitura;
  try {
    planilha = await (ctx.db as unknown as { transaction<T>(f: (tx: unknown) => Promise<T>): Promise<T> }).transaction((tx) => gravarLeituraNaLinha(tx as PublicationCtx['db'], ctx.now, articleId, b));
  } catch (e) {
    const parada = highFactOf({ unsupported_facts: b.unsupportedFacts, unsupported_high: b.altas, unsupported_medium: b.medias, unsupported_low: b.baixas });
    planilha = { linhas: [], parada, erros: [`falha ao gravar na linha do piloto: ${e instanceof Error ? e.message : 'erro desconhecido'}`] };
  }
  return { status: 201, body: { ...b, planilha } };
}
