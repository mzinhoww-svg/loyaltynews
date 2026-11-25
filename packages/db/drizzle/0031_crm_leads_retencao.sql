ALTER TABLE "crm_leads" ADD COLUMN "ultimo_contato_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD COLUMN "descartado_em" timestamp with time zone;--> statement-breakpoint
-- Retencao do lead (DP-55): ultimo_contato_em e descartado_em sao mantidos por GATILHO, para valer em qualquer caminho de escrita (persist do dominio, SQL, CLI).
-- Lead existente: o relogio comeca em criado_em (contato) e, se ja descartado, AGORA (a data do descarte nao foi gravada: conservador, os 30 dias contam da migracao).
UPDATE "crm_leads" SET "ultimo_contato_em" = "criado_em";--> statement-breakpoint
UPDATE "crm_leads" SET "descartado_em" = now() WHERE "status" = 'descartado';--> statement-breakpoint
CREATE FUNCTION ln_crm_lead_retencao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ultimo_contato_em := now();
    NEW.descartado_em := CASE WHEN NEW.status = 'descartado' THEN now() ELSE NULL END;
    RETURN NEW;
  END IF;
  -- qualquer mudanca do lead (status, conta, dados, mensagem) e interacao; regravar os mesmos valores nao conta
  IF (to_jsonb(NEW) - 'ultimo_contato_em' - 'descartado_em') IS DISTINCT FROM (to_jsonb(OLD) - 'ultimo_contato_em' - 'descartado_em')
     AND NEW.ultimo_contato_em IS NOT DISTINCT FROM OLD.ultimo_contato_em THEN
    NEW.ultimo_contato_em := now();
  END IF;
  IF NEW.status = 'descartado' AND OLD.status <> 'descartado' THEN
    NEW.descartado_em := now();
  ELSIF NEW.status <> 'descartado' THEN
    NEW.descartado_em := NULL;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER crm_leads_retencao BEFORE INSERT OR UPDATE ON "crm_leads" FOR EACH ROW EXECUTE FUNCTION ln_crm_lead_retencao();--> statement-breakpoint
-- interacao = oportunidade ligada ao lead criada ou alterada (mudanca de estagio, proxima acao...): renova o ultimo contato do lead
CREATE FUNCTION ln_crm_opp_toca_lead() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE "crm_leads" SET "ultimo_contato_em" = now() WHERE "id" = NEW.lead_id;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER crm_opp_toca_lead AFTER INSERT OR UPDATE ON "crm_opportunities" FOR EACH ROW EXECUTE FUNCTION ln_crm_opp_toca_lead();--> statement-breakpoint
CREATE INDEX "crm_leads_retencao_idx" ON "crm_leads" USING btree ("ultimo_contato_em") WHERE "conta_id" IS NULL;--> statement-breakpoint
CREATE INDEX "crm_leads_descartado_idx" ON "crm_leads" USING btree ("descartado_em") WHERE "descartado_em" IS NOT NULL;
