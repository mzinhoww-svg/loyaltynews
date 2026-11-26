// Fila de pedidos do titular no Studio (DP-38). RBAC `titular` (editor-chefe e admin; demais 403). Toda escrita é auditada com ator e data.
//   GET  /api/studio/correcoes?estado=&responsavel=          lista, ordenada pelo prazo (sem nome, contato, texto, url nem decisão)
//   GET  /api/studio/correcoes/{id}                          detalhe + texto + nome + contato + trilha de auditoria (a consulta é auditada)
//   POST /api/studio/correcoes/{id}/atribuir {responsavel}   recebido|em_analise → em_analise
//   POST /api/studio/correcoes/{id}/decidir  {acao,...}      → corrigido | removido | negado; 409 ALREADY_DECIDED se já decidido
// A decisão é REGISTRADA aqui. Aplicar o efeito na exibição pública (ocultar pessoa/cargo, corrigir campo) é passo seguinte do
// Intelligence: o pedido decidido traz `efeitoPublico: 'pendente'` até isso existir. Nada apaga evidência.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { audit, authorize, clientIp } from '@ln/auth';
import { schema } from '@ln/db';
import { getDeps } from './deps';
import { EFEITO_APLICADO } from './titular-efeito';
import { protocoloDe } from './titular';
import { HttpError, json, parse, queryObject, readBody, toResponse } from './http';

const t = schema.titularPedidos;
type Row = typeof t.$inferSelect;
const ESTADOS = ['recebido', 'em_analise', 'corrigido', 'removido', 'negado'] as const;
const ABERTOS = ['recebido', 'em_analise'];
const RESPONSAVEIS = ['admin', 'editor_chefe'];

/** Projeção da LISTA (consulta não auditada): sem texto livre do titular (resumo, url, decisão). Achado 3 do QA 7. */
export const itemTitular = (r: Row) => ({
  id: r.id,
  /** Protocolo que o leitor recebeu; permite achar o pedido sem pedir o id interno. */
  protocolo: protocoloDe(r.id),
  recebido_em: r.recebidoEm.toISOString(),
  prazo_em: r.prazoEm.toISOString(),
  estado: r.estado,
  responsavel: r.responsavel,
  alvo: r.alvoTipo && r.alvoId ? { tipo: r.alvoTipo, id: r.alvoId, nome: null, empresa: null } : null,
  pedido: r.tipo,
  ...(r.decididoEm
    ? { decidido_por: r.decididoPor, decidido_em: r.decididoEm.toISOString(), efeitoPublico: (EFEITO_APLICADO ? 'aplicado' : 'pendente') as 'aplicado' | 'pendente' }
    : {}),
});

/** Projeção completa: só em respostas auditadas (detalhe, atribuir, decidir). */
export const itemTitularCompleto = (r: Row) => ({ ...itemTitular(r), url: r.url, ...(r.decididoEm ? { decisao: r.decisao } : {}) });

const ListQ = z.object({ estado: z.enum(ESTADOS).optional(), responsavel: z.string().trim().min(1).max(200).optional() });
const Atribuir = z.object({ responsavel: z.string().trim().min(1).max(200) });
const Motivo = z.string().trim().max(2000).optional();
const Campos = z
  .record(z.string().min(1).max(60), z.string().max(2000))
  .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 20, 'informe de 1 a 20 campos');
const Decidir = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('corrigir'), campos: Campos, motivo: Motivo }),
  z.object({ acao: z.literal('remover_cargo'), motivo: Motivo }),
  z.object({ acao: z.literal('remover_pessoa'), motivo: Motivo }),
  z.object({ acao: z.literal('negar'), motivo: z.string().trim().min(5).max(2000) }),
]);
const ESTADO_DA_ACAO = { corrigir: 'corrigido', remover_cargo: 'removido', remover_pessoa: 'removido', negar: 'negado' } as const;

type Next = { params?: Promise<{ path?: string[] } | Record<string, unknown>> };

/** Dispatcher do catch-all opcional /api/studio/correcoes/[[...path]]. */
export async function dispatchTitular(req: Request, next?: Next): Promise<Response> {
  const requestId = req.headers.get('x-request-id') ?? randomUUID();
  try {
    const raw = ((await next?.params) as { path?: string[] | string } | undefined)?.path;
    const path = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    const deps = getDeps();
    if (!deps) throw new HttpError(503, 'NOT_CONFIGURED', 'Banco não configurado neste ambiente.');
    const m = req.method;
    const action = m === 'GET' ? 'read' : path[1] === 'decidir' ? 'transition' : 'update';
    const s = await authorize(deps.auth, req.headers, 'titular', action);
    const db = deps.db;
    const now = deps.now();
    const ip = clientIp(req.headers);
    const trail = (id: string, acao: string, detalhe: Record<string, unknown>) =>
      audit(db, {
        actorId: s.userId, actorRole: s.role, action: `titular.${acao}`, resource: 'titular_pedidos', resourceId: id, ip,
        detalhe: { ...detalhe, requestId }, at: now,
      });
    const load = async (id: string) => {
      const [r] = await db.select().from(t).where(eq(t.id, id));
      if (!r) throw new HttpError(404, 'NOT_FOUND', 'Pedido não encontrado.');
      return r;
    };

    let res: Response;
    if (m === 'GET' && path.length === 0) {
      const q = parse(ListQ, queryObject(new URL(req.url)));
      const rows = await db
        .select()
        .from(t)
        .where(and(q.estado ? eq(t.estado, q.estado) : undefined, q.responsavel ? eq(t.responsavel, q.responsavel) : undefined))
        .orderBy(asc(t.prazoEm))
        .limit(500);
      res = json({ items: rows.map(itemTitular) });
    } else if (m === 'GET' && path.length === 1) {
      const r = await load(path[0]!);
      await trail(r.id, 'pedido_consultado', {}); // leitura de dado pessoal também entra na trilha
      const logs = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.resource, 'titular_pedidos'), eq(schema.auditLog.resourceId, r.id)))
        .orderBy(desc(schema.auditLog.at));
      res = json({
        ...itemTitularCompleto(r),
        texto: r.texto,
        nome: r.nome,
        contato: r.contato,
        auditoria: logs.map((l) => ({
          em: l.at.toISOString(),
          ator: l.actorId ?? 'titular',
          acao: l.action,
          motivo: (l.detalhe as { motivo?: string } | null)?.motivo ?? null,
        })),
      });
    } else if (m === 'POST' && path.length === 2 && path[1] === 'atribuir') {
      const b = await readBody(req, Atribuir);
      const r = await load(path[0]!);
      if (!ABERTOS.includes(r.estado)) throw new HttpError(409, 'ALREADY_DECIDED', 'Pedido já decidido.');
      const [u] = await db.select({ id: schema.user.id, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, b.responsavel));
      if (!u || !RESPONSAVEIS.includes(u.role)) throw new HttpError(422, 'INVALID_ASSIGNEE', 'O responsável tem de ser editor-chefe ou admin.');
      const [upd] = await db
        .update(t)
        .set({ responsavel: u.id, estado: 'em_analise', atualizadoEm: now })
        .where(and(eq(t.id, r.id), inArray(t.estado, ABERTOS)))
        .returning();
      if (!upd) throw new HttpError(409, 'ALREADY_DECIDED', 'Pedido já decidido.');
      await trail(r.id, 'pedido_atribuido', { responsavel: u.id });
      res = json(itemTitularCompleto(upd));
    } else if (m === 'POST' && path.length === 2 && path[1] === 'decidir') {
      const b = await readBody(req, Decidir);
      const r = await load(path[0]!);
      const estado = ESTADO_DA_ACAO[b.acao];
      const decisao = { acao: b.acao, ...(b.motivo ? { motivo: b.motivo } : {}), ...('campos' in b ? { campos: b.campos } : {}) };
      const [upd] = await db
        .update(t)
        .set({ estado, decisao, decididoPor: s.userId, decididoEm: now, atualizadoEm: now, responsavel: r.responsavel ?? s.userId })
        .where(and(eq(t.id, r.id), inArray(t.estado, ABERTOS)))
        .returning();
      if (!upd) throw new HttpError(409, 'ALREADY_DECIDED', 'Pedido já decidido.');
      await trail(r.id, 'pedido_decidido', {
        acao: b.acao, estado, ...(b.motivo ? { motivo: b.motivo } : {}), ...('campos' in b ? { campos: Object.keys(b.campos) } : {}),
      });
      res = json(itemTitularCompleto(upd));
    } else {
      throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
    }
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (e) {
    return toResponse(e, requestId);
  }
}
