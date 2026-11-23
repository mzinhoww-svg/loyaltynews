// POST /api/publico/correcoes — canal do titular (DP-38): pedido de correção ou remoção de dado pessoal exibido no portal.
//  - público, sem sessão e sem CAPTCHA de terceiros: limite por IP e por contato (auth_attempt, 5 por 15 min), honeypot `site`,
//    teto de pedidos em aberto e dedupe do pedido idêntico em aberto;
//  - grava na fila `titular_pedidos` (estado `recebido`) e audita `titular.pedido_recebido` só com id e tipo (sem dado pessoal, sem IP);
//  - a resposta é sempre a mesma (202 {status:'recebido'}): não devolve id nem eco de dados, não revela se o pedido já existia.
import { createHash } from 'node:crypto';
import { count, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { acquireAttempt, audit } from '@ln/auth';
import { schema } from '@ln/db';
import { HttpError, json, newId, readBody, type RouteFn } from './http';

export const MAX_PEDIDOS_ABERTOS = 500;

const http = (u: string) => /^https?:\/\//i.test(u);

export const PedidoTitular = z.object({
  nome: z.string().trim().min(2).max(200),
  contato: z.email().trim().max(320),
  url: z.url().trim().max(2048).refine(http, 'use um endereço http(s)'),
  tipo: z.enum(['correcao', 'remocao']),
  texto: z.string().trim().min(10).max(5000),
  /** Honeypot: campo invisível no formulário; preenchido = robô. */
  site: z.string().max(500).optional(),
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const RECEBIDO = () => json({ status: 'recebido' }, 202);
const muitos = () => new HttpError(429, 'TOO_MANY_REQUESTS', 'Muitos pedidos. Tente novamente mais tarde.');

export const pedidoTitular: RouteFn = async (req, c) => {
  const b = await readBody(req, PedidoTitular);
  if (b.site) return RECEBIDO(); // honeypot: finge sucesso, descarta
  const now = c.deps.now();
  const contato = b.contato.toLowerCase();

  if (c.ip && !(await acquireAttempt(c.deps.db, 'form', `titular:${c.ip}`, now)).allowed) throw muitos();
  if (!(await acquireAttempt(c.deps.db, 'form', `titular-contato:${sha(contato)}`, now)).allowed) throw muitos();

  const t = schema.titularPedidos;
  const [abertos] = await c.deps.db.select({ n: count() }).from(t).where(inArray(t.estado, ['recebido', 'em_analise']));
  if ((abertos?.n ?? 0) >= MAX_PEDIDOS_ABERTOS) throw new HttpError(429, 'FILA_CHEIA', 'Há pedidos demais em análise. Tente mais tarde.');

  const id = newId();
  const ins = await c.deps.db
    .insert(t)
    .values({
      id, tipo: b.tipo, estado: 'recebido', nome: b.nome, contato, url: b.url, texto: b.texto,
      chaveDedupe: sha(`${contato}|${b.url}|${b.tipo}|${b.texto}`), recebidoEm: now, atualizadoEm: now,
    })
    .onConflictDoNothing()
    .returning({ id: t.id });
  if (ins.length) {
    await audit(c.deps.db, { action: 'titular.pedido_recebido', resource: 'titular_pedidos', resourceId: id, detalhe: { tipo: b.tipo, requestId: c.requestId }, at: now });
  }
  return RECEBIDO();
};
