// Linhas do piloto do OpenBot (planilha de medição, DP-41) no Studio.
//  - `GET /api/studio/openbot/piloto/linhas` (admin e editor-chefe, auditada): uma linha por tarefa e tentativa, na ordem de started_at, task_id, attempt, com as colunas do
//    AgentOps (PILOT_CSV_COLUMNS de @ln/openbot) e, nas violações tratadas, `tratada` = { por, em, motivo, acao } (a violação continua contando no critério de 0 violações).
//    SÓ LEITURA: não despacha, não escreve e funciona com o piloto desligado (lista vazia). Cegueira entre leitores: devolve só o que está gravado na linha (os `unsupported_*`
//    transcritos do leitor 1 pelo AgentOps); nada do leitor 2 passa por aqui.
//  - `POST /api/studio/openbot/pilot/rows/:taskId/:attempt/resolve` (só admin, auditada): marca a violação como TRATADA (decisão PM-2026-11-23-D). Libera o despacho e a retomada;
//    NÃO apaga nem edita a linha. Só vale para linha com parada imediata (publicar, API tarifada, segredo em log, ferramenta fora do contrato): linha inválida por campo faltante
//    se corrige por patch, não por aqui (409 NOT_A_VIOLATION). Segredo em log exige acaoTomada = `segredo_rotacionado`. Idempotente: repetir devolve a resolução original.
import { apiError } from '@ln/contracts';
import { BLOCKING_GATE_REASONS, configInvalidOf } from '@ln/agents';
import { audit } from '@ln/auth';
import { schema } from '@ln/db';
import { desc, eq } from 'drizzle-orm';
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
  // Fronteira da amostra: o último `resume` auditado. A planilha mostra tudo; o CSV de medição só leva o que começou depois dele.
  const ultimo = (await c.deps.db.select({ at: schema.auditLog.at }).from(schema.auditLog).where(eq(schema.auditLog.action, 'openbot.piloto_retomado')).orderBy(desc(schema.auditLog.at)).limit(1))[0];
  return json({ items, sampleStartedAt: ultimo?.at ? ultimo.at.toISOString() : null }, 200, NO_STORE);
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

/**
 * Falha editorial que NÃO pode ser escondida como config_invalid: fato de gravidade alta, veredito bloqueado ou approved com
 * motivo bloqueante. A linha continua na planilha; o operador precisa ver o motivo editorial.
 */
export function editorialBlockerOf(r: PilotRow): string[] {
  const out: string[] = [];
  if ((r.unsupported_high ?? 0) >= 1) out.push(`fato de gravidade alta (${r.unsupported_high})`);
  if (r.gate_verdict === 'blocked') out.push(`veredito bloqueado (${(r.gate_reasons ?? []).join(', ') || 'sem motivo'})`);
  const blocking = (r.gate_reasons ?? []).filter((x) => (BLOCKING_GATE_REASONS as readonly string[]).includes(x));
  if (r.gate_verdict === 'approved' && blocking.length) out.push(`approved com motivo bloqueante (${blocking.join(', ')})`);
  return out;
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
  const editorial = body.acaoTomada === 'editorial_invalid';
  let falhaEditorial: string[] = [];
  if (editorial) {
    if (row.gate_verdict === 'approved') return json(apiError('APPROVED_NOT_ALLOWED', 'linha aprovada não aceita editorial_invalid.'), 409, NO_STORE);
    if (v.length) return json(apiError('NOT_EDITORIAL_ONLY', `a linha tem parada imediata (${v.join(', ')}): trate como violação, não como editorial.`), 409, NO_STORE);
    falhaEditorial = editorialBlockerOf(row);
    if (falhaEditorial.length === 0) return json(apiError('NOT_EDITORIAL', 'a linha não tem falha editorial (gate blocked ou fato ALTO): não é este caminho.'), 409, NO_STORE);
  } else {
    if (v.length === 0) return json(apiError('NOT_A_VIOLATION', 'a linha não tem parada imediata: linha inválida por campo faltante se corrige por patch, não por resolução.'), 409, NO_STORE);
    if (row.secret_in_log && body.acaoTomada !== 'segredo_rotacionado') return json(apiError('ACTION_REQUIRED', 'segredo em log só se trata com acaoTomada = segredo_rotacionado.'), 409, NO_STORE);
  }
  const out = await new PgPilotResolutionStore(c.deps.db, c.deps.now).resolve(taskId, attempt, c.session!.userId, body.motivo, body.acaoTomada);
  if (out.result === 'no_row') return json(apiError('NOT_FOUND', 'linha do piloto não encontrada.'), 404, NO_STORE);
  const x = out.resolution!;
  // Auditoria com a linha e o motivo (append-only via audit_log; a resolução é insert-only pela aplicação).
  await audit(c.deps.db, {
    actorId: c.session!.userId,
    actorRole: c.session!.role,
    action: 'openbot.piloto_linha_resolvida',
    resource: 'openbot',
    resourceId: `${taskId}#${attempt}`,
    ip: c.ip,
    detalhe: { requestId: c.requestId, status: out.result === 'created' ? 201 : 200, motivo: body.motivo, acao: body.acaoTomada, ...(editorial ? { falha_editorial: falhaEditorial } : { violacoes: v }) },
    at: c.deps.now(),
  });
  return json({
    taskId, attempt, ...(editorial ? { falha_editorial: falhaEditorial } : { violacoes: v }),
    tratada: { por: x.resolvido_por, em: x.resolvido_em, motivo: x.motivo, acao: x.acao_tomada }, jaResolvida: out.result === 'exists',
  }, out.result === 'created' ? 201 : 200, NO_STORE);
};

const ConfigInvalidBody = z.object({ motivo: z.string().trim().min(10).max(500) });

/**
 * Marca como EXCLUÍDA POR CONFIGURAÇÃO uma linha cuja invalidade é só de conta/modelo (criada antes do D1): preserva a linha na
 * planilha, grava a resolução com ação `config_invalid` e libera o portão de despacho. Não aprova nada e não substitui a violação:
 * linha com parada imediata (publicar, API tarifada, segredo em log, ferramenta fora do contrato) continua exigindo `resolve`.
 */
export const openbotPilotConfigInvalid: RouteFn = async (req, c) => {
  const taskId = c.params.taskId ?? '';
  const attemptRaw = c.params.attempt ?? '';
  if (!ID_RE.test(taskId) || !/^\d{1,4}$/.test(attemptRaw)) throw new HttpError(400, 'VALIDATION_ERROR', 'taskId ou attempt inválido.');
  const body = await readBody(req, ConfigInvalidBody);
  const attempt = Number(attemptRaw);
  const row = (await new PgPilotRowStore(c.deps.db, c.deps.now).all()).find((r) => r.task_id === taskId && r.attempt === attempt);
  if (!row) return json(apiError('NOT_FOUND', 'linha do piloto não encontrada.'), 404, NO_STORE);
  const v = violationsOf(row);
  if (v.length) return json(apiError('NOT_CONFIG_ONLY', `a linha tem parada imediata (${v.join(', ')}): trate como violação, não como configuração.`), 409, NO_STORE);
  const editorial = editorialBlockerOf(row);
  if (editorial.length) return json(apiError('EDITORIAL_FAILURE', `a linha tem falha editorial (${editorial.join('; ')}): não se exclui por configuração.`), 409, NO_STORE);
  const config = configInvalidOf(row);
  if (config.length === 0) return json(apiError('NOT_CONFIG_INVALID', 'a linha não tem invalidade de conta/modelo: não há o que excluir por configuração.'), 409, NO_STORE);
  const out = await new PgPilotResolutionStore(c.deps.db, c.deps.now).resolve(taskId, attempt, c.session!.userId, body.motivo, 'config_invalid');
  if (out.result === 'no_row') return json(apiError('NOT_FOUND', 'linha do piloto não encontrada.'), 404, NO_STORE);
  const x = out.resolution!;
  // Auditoria com a linha e o motivo (o genérico não conhece taskId/attempt e não veria o corpo já consumido).
  await audit(c.deps.db, {
    actorId: c.session!.userId,
    actorRole: c.session!.role,
    action: 'openbot.piloto_linha_config_invalida',
    resource: 'openbot',
    resourceId: `${taskId}#${attempt}`,
    ip: c.ip,
    detalhe: { requestId: c.requestId, status: out.result === 'created' ? 201 : 200, motivo: body.motivo, config },
    at: c.deps.now(),
  });
  return json({ taskId, attempt, config, tratada: { por: x.resolvido_por, em: x.resolvido_em, motivo: x.motivo, acao: x.acao_tomada }, jaResolvida: out.result === 'exists' }, out.result === 'created' ? 201 : 200, NO_STORE);
};
