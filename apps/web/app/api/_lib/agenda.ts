// Agenda de eventos com MODERAÇÃO. Evento criado pela redação nasce aprovado; sugestão pública nasce pendente e só
// vai ao público depois de decisão humana (aprovado/rejeitado, com motivo e auditoria). Evento patrocinado é
// sinalizado (`patrocinado`) para o Portal rotular (F-074); sugestão pública nunca é patrocinada.
import { createHash } from 'node:crypto';
import { and, asc, count, eq, gte, lte } from 'drizzle-orm';
import { acquireAttempt, audit } from '@ln/auth';
import { schema } from '@ln/db';
import { hoje } from './midia';
import { HttpError, json, newId, parse, queryObject, readBody, type RouteFn } from './http';
import { AgendaCreate, AgendaModeracao, AgendaPatch, AgendaQuery, AgendaSugestao } from './schemas';

/** Teto de sugestões públicas pendentes: com a fila cheia, novas sugestões recebem 429 até a redação decidir. */
export const MAX_SUGESTOES_PENDENTES = 200;
const MAX_DURACAO_DIAS = 30;
const JANELA_FUTURO_DIAS = 730;

type Row = typeof schema.agendaEvents.$inferSelect;

const range = (q: { from?: string; to?: string }) =>
  and(q.from ? gte(schema.agendaEvents.fim, q.from) : undefined, q.to ? lte(schema.agendaEvents.inicio, q.to) : undefined);
const order = [asc(schema.agendaEvents.inicio), asc(schema.agendaEvents.id)] as const;

/** Visão pública: só o que o leitor precisa (nada de moderação, autor ou chave interna). */
export const publicView = (e: Row) => ({
  id: e.id, titulo: e.titulo, inicio: e.inicio, fim: e.fim, local: e.local, url: e.url, editorias: e.editorias, patrocinado: e.patrocinado, fonteUrl: e.fonteUrl,
});

export const listAgenda: RouteFn = async (_req, c) => {
  const q = parse(AgendaQuery, queryObject(c.url));
  const where = and(range(q), q.moderacao ? eq(schema.agendaEvents.moderacao, q.moderacao) : undefined, q.origem ? eq(schema.agendaEvents.origem, q.origem) : undefined);
  return json({ data: await c.deps.db.select().from(schema.agendaEvents).where(where).orderBy(...order) });
};

/** Público: só APROVADOS que ainda não terminaram (ou no intervalo pedido). */
export const publicListAgenda: RouteFn = async (_req, c) => {
  const q = parse(AgendaQuery.pick({ from: true, to: true }), queryObject(c.url));
  const from = q.from ?? hoje(c.deps.now());
  const rows = await c.deps.db
    .select()
    .from(schema.agendaEvents)
    .where(and(range({ from, to: q.to }), eq(schema.agendaEvents.moderacao, 'aprovado')))
    .orderBy(...order);
  return json({ data: rows.map(publicView) }, 200, { 'cache-control': 'public, max-age=300' });
};

export const getAgenda: RouteFn = async (_req, c) => {
  const [e] = await c.deps.db.select().from(schema.agendaEvents).where(eq(schema.agendaEvents.id, c.params.id ?? ''));
  if (!e) throw new HttpError(404, 'NOT_FOUND', 'Evento não encontrado.');
  return json({ data: e });
};

export const createAgenda: RouteFn = async (req, c) => {
  const b = await readBody(req, AgendaCreate);
  const now = c.deps.now();
  const [e] = await c.deps.db
    .insert(schema.agendaEvents)
    .values({ id: newId(), ...b, url: b.url ?? null, moderacao: 'aprovado', origem: 'interno', moderadoPor: c.session?.userId ?? null, moderadoEm: now, criadoEm: now })
    .returning();
  return json({ data: e }, 201);
};

export const patchAgenda: RouteFn = async (req, c) => {
  const b = await readBody(req, AgendaPatch);
  const [cur] = await c.deps.db.select().from(schema.agendaEvents).where(eq(schema.agendaEvents.id, c.params.id ?? ''));
  if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Evento não encontrado.');
  if ((b.fim ?? cur.fim) < (b.inicio ?? cur.inicio)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Fim anterior ao início.', [{ path: 'fim', message: 'fim anterior ao início' }]);
  }
  const [e] = await c.deps.db.update(schema.agendaEvents).set(b).where(eq(schema.agendaEvents.id, cur.id)).returning();
  return json({ data: e });
};

export const deleteAgenda: RouteFn = async (_req, c) => {
  const d = await c.deps.db.delete(schema.agendaEvents).where(eq(schema.agendaEvents.id, c.params.id ?? '')).returning();
  if (!d[0]) throw new HttpError(404, 'NOT_FOUND', 'Evento não encontrado.');
  return new Response(null, { status: 204 });
};

/** Decisão de moderação: aprovar ou rejeitar (com motivo). Repetir a mesma decisão é inofensivo. Auditada com ator e motivo. */
export const moderateAgenda: RouteFn = async (req, c) => {
  const b = await readBody(req, AgendaModeracao);
  const session = c.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  const [cur] = await c.deps.db.select().from(schema.agendaEvents).where(eq(schema.agendaEvents.id, c.params.id ?? ''));
  if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Evento não encontrado.');
  if (cur.moderacao === b.estado && (b.estado === 'aprovado' || cur.motivoRejeicao === b.motivo)) return json({ data: cur });
  const now = c.deps.now();
  const [e] = await c.deps.db
    .update(schema.agendaEvents)
    .set({ moderacao: b.estado, motivoRejeicao: b.estado === 'rejeitado' ? b.motivo! : null, moderadoPor: session.userId, moderadoEm: now })
    .where(eq(schema.agendaEvents.id, cur.id))
    .returning();
  await audit(c.deps.db, {
    actorId: session.userId, actorRole: session.role, action: `agenda.${b.estado}`, resource: 'agenda', resourceId: cur.id, ip: c.ip,
    detalhe: { de: cur.moderacao, para: b.estado, ...(b.motivo ? { motivo: b.motivo } : {}) }, at: now,
  });
  return json({ data: e });
};

/**
 * Sugestão pública de evento (formulário do portal). Defesas, na ordem: campo armadilha (robô recebe 202 e nada é
 * gravado); limite por IP (5 por 15 min; vale com TRUSTED_PROXY_HOPS); teto de pendentes; regras de conteúdo (sem link
 * no título, datas em janela razoável, duração máxima); sugestão idêntica pendente não duplica. Sem dado pessoal.
 * Sempre responde 202 (a sugestão só vai ao público depois de moderação) e nunca devolve o id.
 */
export const suggestAgenda: RouteFn = async (req, c) => {
  const b = await readBody(req, AgendaSugestao);
  if (b.site) return json({ status: 'recebido' }, 202); // honeypot: finge sucesso, descarta
  const now = c.deps.now();
  const today = hoje(now);

  if (c.ip) {
    const gate = await acquireAttempt(c.deps.db, 'form', `agenda:${c.ip}`, now);
    if (!gate.allowed) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Muitas sugestões. Tente novamente mais tarde.');
  }
  if (/https?:\/\/|www\./i.test(b.titulo)) throw new HttpError(400, 'VALIDATION_ERROR', 'Entrada inválida.', [{ path: 'titulo', message: 'sem links no título; use o campo url' }]);
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const erros: { path: string; message: string }[] = [];
  if (b.fim < b.inicio) erros.push({ path: 'fim', message: 'fim anterior ao início' });
  if (b.fim < today) erros.push({ path: 'fim', message: 'evento já terminou' });
  if (b.inicio > addDays(today, JANELA_FUTURO_DIAS)) erros.push({ path: 'inicio', message: `além de ${JANELA_FUTURO_DIAS} dias` });
  if (b.fim >= b.inicio && Date.parse(b.fim) - Date.parse(b.inicio) > MAX_DURACAO_DIAS * 86_400_000) erros.push({ path: 'fim', message: `duração acima de ${MAX_DURACAO_DIAS} dias` });
  if (erros.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Entrada inválida.', erros);

  const [pend] = await c.deps.db
    .select({ n: count() })
    .from(schema.agendaEvents)
    .where(and(eq(schema.agendaEvents.moderacao, 'pendente'), eq(schema.agendaEvents.origem, 'publico')));
  if ((pend?.n ?? 0) >= MAX_SUGESTOES_PENDENTES) throw new HttpError(429, 'FILA_CHEIA', 'Há sugestões demais aguardando moderação. Tente mais tarde.');

  const chaveDedupe = createHash('sha256').update(`${b.titulo.toLowerCase()}|${b.inicio}`).digest('hex');
  await c.deps.db
    .insert(schema.agendaEvents)
    .values({
      id: newId(), titulo: b.titulo, inicio: b.inicio, fim: b.fim, local: b.local, url: b.url ?? null, editorias: b.editorias, patrocinado: false,
      fonteUrl: b.fonteUrl, moderacao: 'pendente', origem: 'publico', chaveDedupe, criadoEm: now,
    })
    .onConflictDoNothing(); // idêntica e ainda pendente: mesma resposta, nenhuma linha nova
  return json({ status: 'recebido' }, 202);
};
