// Linhas do piloto do OpenBot (planilha de medição, DP-41) no Studio.
//  - `GET /api/studio/openbot/piloto/linhas` (admin e editor-chefe, auditada): uma linha por tarefa e tentativa, na ordem de started_at, task_id, attempt, com as colunas do
//    AgentOps (PILOT_CSV_COLUMNS de @ln/openbot) e, nas violações tratadas, `tratada` = { por, em, motivo, acao } (a violação continua contando no critério de 0 violações).
//    SÓ LEITURA: não despacha, não escreve e funciona com o piloto desligado (lista vazia). Cegueira entre leitores: devolve só o que está gravado na linha (os `unsupported_*`
//    transcritos do leitor 1 pelo AgentOps); nada do leitor 2 passa por aqui.
//  - `POST /api/studio/openbot/pilot/rows/:taskId/:attempt/resolve` (só admin, auditada): marca a violação como TRATADA (decisão PM-2026-11-23-D). Libera o despacho e a retomada;
//    NÃO apaga nem edita a linha. Só vale para linha com parada imediata (publicar, API tarifada, segredo em log, ferramenta fora do contrato): linha inválida por campo faltante
//    se corrige por patch, não por aqui (409 NOT_A_VIOLATION). Segredo em log exige acaoTomada = `segredo_rotacionado`. Idempotente: repetir devolve a resolução original.
import { apiError } from '@ln/contracts';
import { ID_RE, type PilotRow } from '@ln/openbot';
import { PgPilotResolutionStore, PgPilotRowStore } from '@ln/workers/openbot-pg';
import { z } from 'zod';
import { HttpError, json, readBody, type RouteFn } from './http';

const NO_STORE = { 'cache-control': 'no-store' } as const;

export const openbotPilotRows: RouteFn = async (_req, c) => {
  const rows = await new PgPilotRowStore(c.deps.db, c.deps.now).all();
  const done = new Map((await new PgPilotResolutionStore(c.deps.db, c.deps.now).all()).map((r) => [`${r.task_id}#${r.attempt}`, r]));
  const items = rows.map((r) => {
    const x = done.get(`${r.task_id}#${r.attempt}`);
    return x ? { ...r, tratada: { por: x.resolvido_por, em: x.resolvido_em, motivo: x.motivo, acao: x.acao_tomada } } : r;
  });
  return json({ items }, 200, NO_STORE);
};

const ResolveBody = z.object({ motivo: z.string().trim().min(10).max(500), acaoTomada: z.string().trim().min(1).max(200) });

/** Quais paradas imediatas a linha carrega (as da planilha do AgentOps). */
export function violationsOf(r: Pick<PilotRow, 'published_attempt' | 'tarifada_api_call' | 'secret_in_log' | 'tool_outside_contract'>): string[] {
  return [
    ...(r.published_attempt ? ['published_attempt'] : []),
    ...(r.tarifada_api_call ? ['tarifada_api_call'] : []),
    ...(r.secret_in_log ? ['secret_in_log'] : []),
    ...(r.tool_outside_contract ? ['tool_outside_contract'] : []),
  ];
}

export const openbotPilotResolve: RouteFn = async (req, c) => {
  const taskId = c.params.taskId ?? '';
  const attemptRaw = c.params.attempt ?? '';
  if (!ID_RE.test(taskId) || !/^\d{1,4}$/.test(attemptRaw)) throw new HttpError(400, 'VALIDATION_ERROR', 'taskId ou attempt inválido.');
  const body = await readBody(req, ResolveBody);
  const attempt = Number(attemptRaw);
  const row = (await new PgPilotRowStore(c.deps.db, c.deps.now).all()).find((r) => r.task_id === taskId && r.attempt === attempt);
  if (!row) return json(apiError('NOT_FOUND', 'linha do piloto não encontrada.'), 404, NO_STORE);
  const v = violationsOf(row);
  if (v.length === 0) return json(apiError('NOT_A_VIOLATION', 'a linha não tem parada imediata: linha inválida por campo faltante se corrige por patch, não por resolução.'), 409, NO_STORE);
  if (row.secret_in_log && body.acaoTomada !== 'segredo_rotacionado') return json(apiError('ACTION_REQUIRED', 'segredo em log só se trata com acaoTomada = segredo_rotacionado.'), 409, NO_STORE);
  const out = await new PgPilotResolutionStore(c.deps.db, c.deps.now).resolve(taskId, attempt, c.session!.userId, body.motivo, body.acaoTomada);
  if (out.result === 'no_row') return json(apiError('NOT_FOUND', 'linha do piloto não encontrada.'), 404, NO_STORE);
  const x = out.resolution!;
  return json({ taskId, attempt, violacoes: v, tratada: { por: x.resolvido_por, em: x.resolvido_em, motivo: x.motivo, acao: x.acao_tomada }, jaResolvida: out.result === 'exists' }, out.result === 'created' ? 201 : 200, NO_STORE);
};
