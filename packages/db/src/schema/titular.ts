// Canal do titular (DP-38): pedidos públicos de correção ou remoção de dados pessoais exibidos no portal (pessoas, cargos, Moves).
// Dono: Frente 02 — LN Backend Engineer 2 (proposta; o Chief Architect pode regenerar a migração no merge).
// DADO PESSOAL (nome e contato do requerente): classe `personal`, acesso restrito ao Studio; nunca sai em API pública.
// Não guarda IP: o limite de taxa usa auth_attempt; a auditoria (audit_log) leva só id e tipo.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const titularPedidos = pgTable(
  'titular_pedidos',
  {
    id: text('id').primaryKey(),
    tipo: text('tipo').notNull(),
    estado: text('estado').notNull().default('recebido'),
    nome: text('nome').notNull(),
    contato: text('contato').notNull(),
    url: text('url').notNull(),
    texto: text('texto').notNull(),
    /** sha256(contato minúsculo|url|tipo|texto): o mesmo pedido em aberto não gera linha nova. */
    chaveDedupe: text('chave_dedupe').notNull(),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('titular_tipo', sql`${t.tipo} IN ('correcao', 'remocao')`),
    check('titular_estado', sql`${t.estado} IN ('recebido', 'em_analise', 'atendido', 'recusado')`),
    uniqueIndex('titular_pedido_aberto_uq').on(t.chaveDedupe).where(sql`${t.estado} IN ('recebido', 'em_analise')`),
    index('titular_estado_idx').on(t.estado, t.recebidoEm),
  ],
);
