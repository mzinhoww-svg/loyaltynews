// POST /api/publico/correcoes — canal do titular (DP-38): pedido de correção ou remoção de dado pessoal exibido no portal.
//  - público, sem sessão e sem CAPTCHA de terceiros: limite por IP e por contato (auth_attempt, 5 por 15 min), honeypot `site`,
//    teto de pedidos em aberto e dedupe do pedido idêntico em aberto;
//  - grava na fila `titular_pedidos` (estado `recebido`) e audita `titular.pedido_recebido` só com id e tipo (sem dado pessoal, sem IP);
//  - a resposta (202) traz um protocolo público derivado do id e o prazo de resposta, sem o id completo nem eco de dados.
import { protocoloDe } from '../../../lib/protocolo-titular';
import { createHash } from 'node:crypto';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { acquireAttempt, audit } from '@ln/auth';
import { schema } from '@ln/db';
import { HttpError, json, newId, readBody, type RouteFn } from './http';

export const MAX_PEDIDOS_ABERTOS = 500;
/** Prazo interno de resposta (dias corridos). PROPOSTA operacional, não prazo legal (R0-10: parecer jurídico pendente). */
export const PRAZO_DIAS = 15;

export type AlvoTipo = 'pessoa' | 'cargo' | 'move';
const ID_OK = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Alvo pela URL do portal: /…/pessoas/<id> → pessoa (com ?cargo=<id> → cargo); /…/moves/<id> → move. */
export function alvoDaUrl(u: string): { tipo: AlvoTipo; id: string } | null {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  let seg: string[];
  try {
    seg = url.pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x));
  } catch {
    return null;
  }
  const cargo = url.searchParams.get('cargo');
  for (let i = 0; i < seg.length - 1; i++) {
    const nx = seg[i + 1]!;
    if (!ID_OK.test(nx)) continue;
    if (seg[i] === 'pessoas') return cargo && ID_OK.test(cargo) ? { tipo: 'cargo', id: cargo } : { tipo: 'pessoa', id: nx };
    if (seg[i] === 'moves') return { tipo: 'move', id: nx };
  }
  return null;
}

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
/** Protocolo público e estável do pedido: prefixo + 12 hex do id (48 bits). Não é credencial de acesso. */
export { protocoloDe };
const PRAZO_MS = PRAZO_DIAS * 86_400_000;
const RECEBIDO = (id: string, prazoEm: Date) =>
  json({ status: 'recebido', protocolo: protocoloDe(id), prazoDias: PRAZO_DIAS, prazoEm: prazoEm.toISOString() }, 202);
const muitos = () => new HttpError(429, 'TOO_MANY_REQUESTS', 'Muitos pedidos. Tente novamente mais tarde.');

export const pedidoTitular: RouteFn = async (req, c) => {
  const b = await readBody(req, PedidoTitular);
  const now = c.deps.now();
  if (b.site) return RECEBIDO(newId(), new Date(now.getTime() + PRAZO_MS)); // honeypot: finge sucesso com a mesma forma, descarta
  const contato = b.contato.toLowerCase();

  if (c.ip && !(await acquireAttempt(c.deps.db, 'form', `titular:${c.ip}`, now)).allowed) throw muitos();
  if (!(await acquireAttempt(c.deps.db, 'form', `titular-contato:${sha(contato)}`, now)).allowed) throw muitos();

  const t = schema.titularPedidos;
  const [abertos] = await c.deps.db.select({ n: count() }).from(t).where(inArray(t.estado, ['recebido', 'em_analise']));
  if ((abertos?.n ?? 0) >= MAX_PEDIDOS_ABERTOS) throw new HttpError(429, 'FILA_CHEIA', 'Há pedidos demais em análise. Tente mais tarde.');

  const id = newId();
  const alvo = alvoDaUrl(b.url);
  const chave = sha(`${contato}|${b.url}|${b.tipo}|${b.texto}`);
  const prazoEm = new Date(now.getTime() + PRAZO_MS);
  const ins = await c.deps.db
    .insert(t)
    .values({
      id, tipo: b.tipo, estado: 'recebido', nome: b.nome, contato, url: b.url, texto: b.texto,
      alvoTipo: alvo?.tipo ?? null, alvoId: alvo?.id ?? null, prazoEm,
      chaveDedupe: chave, recebidoEm: now, atualizadoEm: now,
    })
    .onConflictDoNothing()
    .returning({ id: t.id });
  if (ins.length) {
    await audit(c.deps.db, { action: 'titular.pedido_recebido', resource: 'titular_pedidos', resourceId: id, detalhe: { tipo: b.tipo, requestId: c.requestId }, at: now });
    return RECEBIDO(id, prazoEm);
  }
  // Pedido idêntico já em aberto (índice parcial): devolve o protocolo do pedido existente, sem linha nova nem auditoria nova.
  const [existente] = await c.deps.db
    .select({ id: t.id, prazoEm: t.prazoEm })
    .from(t)
    .where(eq(t.chaveDedupe, chave))
    .orderBy(desc(t.recebidoEm))
    .limit(1);
  if (existente) return RECEBIDO(existente.id, existente.prazoEm);
  throw new HttpError(500, 'PEDIDO_NAO_REGISTRADO', 'Não conseguimos registrar o pedido. Tente de novo em instantes.');
};
