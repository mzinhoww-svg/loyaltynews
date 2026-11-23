CREATE TABLE "site_documentos" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"versao" integer,
	"estado" text NOT NULL,
	"conteudo" jsonb NOT NULL,
	"publicar_em" timestamp with time zone,
	"publicado_em" timestamp with time zone,
	"nota" text,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_documentos_tipo" CHECK ("site_documentos"."tipo" IN ('home', 'menu_principal', 'menu_rodape', 'seo_global', 'links_internos')),
	CONSTRAINT "site_documentos_estado" CHECK ("site_documentos"."estado" IN ('rascunho', 'agendado', 'publicado', 'substituido')),
	CONSTRAINT "site_documentos_versao" CHECK (("site_documentos"."estado" = 'rascunho' AND "site_documentos"."versao" IS NULL) OR ("site_documentos"."estado" <> 'rascunho' AND "site_documentos"."versao" IS NOT NULL AND "site_documentos"."versao" > 0)),
	CONSTRAINT "site_documentos_agendado" CHECK ("site_documentos"."estado" <> 'agendado' OR "site_documentos"."publicar_em" IS NOT NULL),
	CONSTRAINT "site_documentos_publicado" CHECK ("site_documentos"."estado" NOT IN ('publicado', 'substituido') OR "site_documentos"."publicado_em" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "site_redirects" (
	"id" text PRIMARY KEY NOT NULL,
	"origem" text NOT NULL,
	"destino" text NOT NULL,
	"codigo" integer DEFAULT 301 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_redirects_codigo" CHECK ("site_redirects"."codigo" IN (301, 302)),
	CONSTRAINT "site_redirects_origem" CHECK ("site_redirects"."origem" ~ '^/[^/?#]'),
	CONSTRAINT "site_redirects_diferentes" CHECK ("site_redirects"."origem" <> "site_redirects"."destino")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_documentos_versao_uq" ON "site_documentos" USING btree ("tipo","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "site_documentos_rascunho_uq" ON "site_documentos" USING btree ("tipo") WHERE "site_documentos"."estado" = 'rascunho';--> statement-breakpoint
CREATE UNIQUE INDEX "site_documentos_agendado_uq" ON "site_documentos" USING btree ("tipo") WHERE "site_documentos"."estado" = 'agendado';--> statement-breakpoint
CREATE INDEX "site_documentos_tipo_estado_idx" ON "site_documentos" USING btree ("tipo","estado");--> statement-breakpoint
CREATE UNIQUE INDEX "site_redirects_origem_uq" ON "site_redirects" USING btree ("origem");