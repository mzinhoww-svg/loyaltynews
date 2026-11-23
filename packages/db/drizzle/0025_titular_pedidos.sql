CREATE TABLE "titular_pedidos" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"estado" text DEFAULT 'recebido' NOT NULL,
	"nome" text NOT NULL,
	"contato" text NOT NULL,
	"url" text NOT NULL,
	"texto" text NOT NULL,
	"alvo_tipo" text,
	"alvo_id" text,
	"responsavel" text,
	"prazo_em" timestamp with time zone NOT NULL,
	"decisao" jsonb,
	"decidido_por" text,
	"decidido_em" timestamp with time zone,
	"chave_dedupe" text NOT NULL,
	"recebido_em" timestamp with time zone NOT NULL,
	"atualizado_em" timestamp with time zone NOT NULL,
	CONSTRAINT "titular_tipo" CHECK ("titular_pedidos"."tipo" IN ('correcao', 'remocao')),
	CONSTRAINT "titular_estado" CHECK ("titular_pedidos"."estado" IN ('recebido', 'em_analise', 'corrigido', 'removido', 'negado')),
	CONSTRAINT "titular_alvo_tipo" CHECK ("titular_pedidos"."alvo_tipo" IS NULL OR "titular_pedidos"."alvo_tipo" IN ('pessoa', 'cargo', 'move')),
	CONSTRAINT "titular_decidido_coerente" CHECK (("titular_pedidos"."estado" IN ('recebido', 'em_analise')) = ("titular_pedidos"."decidido_em" IS NULL)),
	CONSTRAINT "titular_negado_com_motivo" CHECK ("titular_pedidos"."estado" <> 'negado' OR length(trim(coalesce("titular_pedidos"."decisao"->>'motivo', ''))) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "titular_pedido_aberto_uq" ON "titular_pedidos" USING btree ("chave_dedupe") WHERE "titular_pedidos"."estado" IN ('recebido', 'em_analise');--> statement-breakpoint
CREATE INDEX "titular_estado_idx" ON "titular_pedidos" USING btree ("estado","recebido_em");