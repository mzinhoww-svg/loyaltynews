// Canal do titular (DP-38): pedidos públicos de correção ou remoção de dados pessoais exibidos no portal (pessoas, cargos, Moves).
// Dono: Frente 02 — LN Backend Engineer 2 (tabela própria aprovada pelo PM; o Chief Architect pode regenerar a migração no merge).
// DADO PESSOAL (nome e contato do requerente): classe `personal`, acesso restrito (RBAC `titular`: editor-chefe e admin); nunca sai em API pública.
// Não guarda IP: o limite de taxa usa auth_attempt; a auditoria (audit_log) leva id, tipo e decisão, sem dado pessoal.
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
    /** Alvo derivado da URL ou informado: pessoa | cargo | move, e o id público. Null = não identificado. */
    alvoTipo: text('alvo_tipo'),
    alvoId: text('alvo_id'),
    /** Usuário do Studio responsável (auth_user.id). */
    responsavel: text('responsavel'),
    prazoEm: timestamp('prazo_em', { withTimezone: true }).notNull(),
    /** { acao, motivo?, campos? } */
    decisao: jsonb('decisao'),
    decididoPor: text('decidido_por'),
    decididoEm: timestamp('decidido_em', { withTimezone: true }),
    /** sha256(contato minúsculo|url|tipo|texto): o mesmo pedido em aberto não gera linha nova. */
    chaveDedupe: text('chave_dedupe').notNull(),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('titular_tipo', sql`${t.tipo} IN ('correcao', 'remocao')`),
    check('titular_estado', sql`${t.estado} IN ('recebido', 'em_analise', 'corrigido', 'removido', 'negado')`),
    check('titular_alvo_tipo', sql`${t.alvoTipo} IS NULL OR ${t.alvoTipo} IN ('pessoa', 'cargo', 'move')`),
    check('titular_decidido_coerente', sql`(${t.estado} IN ('recebido', 'em_analise')) = (${t.decididoEm} IS NULL)`),
    check('titular_negado_com_motivo', sql`${t.estado} <> 'negado' OR length(trim(coalesce(${t.decisao}->>'motivo', ''))) > 0`),
    uniqueIndex('titular_pedido_aberto_uq').on(t.chaveDedupe).where(sql`${t.estado} IN ('recebido', 'em_analise')`),
    index('titular_estado_idx').on(t.estado, t.recebidoEm),
  ],
);
