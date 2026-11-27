// Leitura da trilha de auditoria (audit_log) para o Studio. Só leitura: a escrita é de `audit()` (@ln/auth), nunca daqui.
//  - Papéis: admin e editor-chefe (RBAC `auditoria:read`). O IP (dado pessoal) só aparece para o admin.
//  - Filtros: recurso, id do recurso, ação (exata) ou prefixo de ação (`orcamento.`), autor, período; ordem do mais novo ao mais velho.
//  - `detalhe` já foi limpo de segredos na escrita (`redact`). Linhas antigas guardam o e-mail digitado no login (a tabela é append-only): a leitura mascara
//    todo e-mail e a chave `email` inteira, que pode conter outro texto (senha colada no campo). O banco não é alterado.
//  - A própria consulta é auditada (`auditoria.consultada`) com os filtros, sem o resultado.
import { and, count, desc, eq, gte, like, lte } from 'drizzle-orm';
import { EMAIL_REMOVIDO, audit, stripEmails } from '@ln/auth';
import { schema } from '@ln/db';
import { z } from 'zod';
import { json, parse, queryObject, type RouteFn } from './http';

const Query = z.object({
  resource: z.string().trim().min(1).max(60).optional(),
  resourceId: z.string().trim().min(1).max(200).optional(),
  action: z.string().trim().min(1).max(80).optional(),
  /** Prefixo de ação, ex.: `orcamento.` traz `orcamento.kill_switch_acionado` etc. */
  actionPrefix: z.string().trim().min(1).max(80).optional(),
  actorId: z.string().trim().min(1).max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/** `%` e `_` do prefixo valem como texto, não como curinga. */
const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&');

const detalheSemEmail = (detalhe: unknown): unknown => {
  const d = stripEmails(detalhe);
  return d && typeof d === 'object' && !Array.isArray(d) && 'email' in d ? { ...d, email: EMAIL_REMOVIDO } : d;
};

export const listAuditoria: RouteFn = async (_req, c) => {
  const q = parse(Query, queryObject(c.url));
  const t = schema.auditLog;
  const where = and(
    q.resource ? eq(t.resource, q.resource) : undefined,
    q.resourceId ? eq(t.resourceId, q.resourceId) : undefined,
    q.action ? eq(t.action, q.action) : undefined,
    q.actionPrefix ? like(t.action, `${escapeLike(q.actionPrefix)}%`) : undefined,
    q.actorId ? eq(t.actorId, q.actorId) : undefined,
    q.from ? gte(t.at, new Date(q.from)) : undefined,
    q.to ? lte(t.at, new Date(q.to)) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    c.deps.db.select().from(t).where(where).orderBy(desc(t.at), desc(t.id)).limit(q.limit).offset(q.offset),
    c.deps.db.select({ n: count() }).from(t).where(where),
  ]);
  const session = c.session!;
  const verIp = session.role === 'admin';
  // auditar a leitura da trilha (quem olhou, com que filtros); falha de auditoria não esconde a resposta mas fica visível no log do servidor
  await audit(c.deps.db, {
    actorId: session.userId,
    actorRole: session.role,
    action: 'auditoria.consultada',
    resource: 'auditoria',
    ip: c.ip,
    detalhe: { filtros: { resource: q.resource, resourceId: q.resourceId, action: q.action, actionPrefix: q.actionPrefix, actorId: q.actorId, from: q.from, to: q.to }, limit: q.limit, offset: q.offset },
    at: c.deps.now(),
  });
  return json({
    data: rows.map((r) => ({
      id: r.id, at: r.at, actorId: stripEmails(r.actorId), actorRole: r.actorRole, action: r.action, resource: r.resource, resourceId: stripEmails(r.resourceId), ip: verIp ? r.ip : null, detalhe: detalheSemEmail(r.detalhe),
    })),
    total: total?.n ?? 0,
    limit: q.limit,
    offset: q.offset,
  });
};
