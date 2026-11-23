CREATE TABLE "titular_pedidos" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"estado" text DEFAULT 'recebido' NOT NULL,
	"nome" text NOT NULL,
	"contato" text NOT NULL,
	"url" text NOT NULL,
	"texto" text NOT NULL,
	"chave_dedupe" text NOT NULL,
	"recebido_em" timestamp with time zone NOT NULL,
	"atualizado_em" timestamp with time zone NOT NULL,
	CONSTRAINT "titular_tipo" CHECK ("titular_pedidos"."tipo" IN ('correcao', 'remocao')),
	CONSTRAINT "titular_estado" CHECK ("titular_pedidos"."estado" IN ('recebido', 'em_analise', 'atendido', 'recusado'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "titular_pedido_aberto_uq" ON "titular_pedidos" USING btree ("chave_dedupe") WHERE "titular_pedidos"."estado" IN ('recebido', 'em_analise');--> statement-breakpoint
CREATE INDEX "titular_estado_idx" ON "titular_pedidos" USING btree ("estado","recebido_em");