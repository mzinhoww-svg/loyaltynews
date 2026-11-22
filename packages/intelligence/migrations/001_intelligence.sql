-- Loyalty News — Entity Intelligence (Frente 08). ADR-009 (proposta): PostgreSQL relacional temporal.
-- Sem pgvector, sem extensões de grafo. Toda relação/cargo/hierarquia tem evidência e data (NOT NULL).
-- Dado de pessoa (DP-11 P4): só nome, cargo e empresa, com fonte pública. Ampliado: chave desligada.

CREATE SCHEMA IF NOT EXISTS intelligence;
SET search_path TO intelligence, public;

-- Configuração: a chave de dado pessoal ampliado nasce DESLIGADA e só a migração/ADR futura liga.
CREATE TABLE intel_settings (
  key         text PRIMARY KEY,
  bool_value  boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO intel_settings (key, bool_value) VALUES ('extended_personal_data', false);

-- Evidência: toda afirmação aponta para uma fonte pública com data de coleta.
CREATE TABLE evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url    text NOT NULL CHECK (source_url ~* '^https?://'),
  source_name   text NOT NULL,
  source_class  text NOT NULL CHECK (source_class = 'public'),  -- P4: só fonte pública
  retrieved_at  timestamptz NOT NULL,
  content_hash  text,
  excerpt       text CHECK (excerpt IS NULL OR length(excerpt) <= 500),  -- trecho curto, não cópia
  is_mock       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      text NOT NULL,
  trade_name      text,
  normalized_name text NOT NULL UNIQUE,
  kind            text NOT NULL DEFAULT 'company'
                  CHECK (kind IN ('company','program','association','regulator','media','other')),
  evidence_id     uuid NOT NULL REFERENCES evidence(id),
  observed_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Pessoa: somente nome (+ URL de perfil público opcional para desambiguar homônimos).
CREATE TABLE person (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          text NOT NULL,
  normalized_name    text NOT NULL,
  public_profile_url text UNIQUE CHECK (public_profile_url IS NULL OR public_profile_url ~* '^https?://'),
  evidence_id        uuid NOT NULL REFERENCES evidence(id),
  observed_at        timestamptz NOT NULL,
  suppressed_at      timestamptz,            -- supressão a pedido do titular (WF19)
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX person_normalized_name_idx ON person (normalized_name);

-- Dado pessoal ampliado: tabela existe, mas o gatilho recusa qualquer linha com a chave desligada.
CREATE TABLE person_extended (
  person_id   uuid PRIMARY KEY REFERENCES person(id),
  attributes  jsonb NOT NULL,
  evidence_id uuid NOT NULL REFERENCES evidence(id),
  observed_at timestamptz NOT NULL
);
CREATE FUNCTION person_extended_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE((SELECT bool_value FROM intelligence.intel_settings WHERE key = 'extended_personal_data'), false) THEN
    RAISE EXCEPTION 'extended_personal_data_disabled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_extended_guard_trg BEFORE INSERT OR UPDATE ON person_extended
  FOR EACH ROW EXECUTE FUNCTION person_extended_guard();

-- Cargo com vigência. certainty: 'declared' (a fonte afirma) | 'inferred' (nunca é fato).
CREATE TABLE role_assignment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid NOT NULL REFERENCES person(id),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  title            text NOT NULL,
  normalized_title text NOT NULL,
  valid_from       date NOT NULL,
  valid_to         date,
  certainty        text NOT NULL DEFAULT 'declared' CHECK (certainty IN ('declared','inferred')),
  inference_basis  text,
  evidence_id      uuid NOT NULL REFERENCES evidence(id),
  observed_at      timestamptz NOT NULL,
  validated_at     timestamptz NOT NULL,   -- data da última validação contra a fonte
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (certainty = 'declared' OR inference_basis IS NOT NULL),
  UNIQUE (person_id, organization_id, normalized_title, valid_from)
);
CREATE INDEX role_assignment_org_idx ON role_assignment (organization_id);
CREATE INDEX role_assignment_person_idx ON role_assignment (person_id);
CREATE UNIQUE INDEX role_assignment_one_open ON role_assignment (person_id, organization_id, normalized_title)
  WHERE valid_to IS NULL;

-- Relações corporativas (controladora, parceria, coalizão, fornecedor...).
CREATE TABLE org_relation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_org_id     uuid NOT NULL REFERENCES organization(id),
  to_org_id       uuid NOT NULL REFERENCES organization(id),
  relation_type   text NOT NULL CHECK (relation_type IN ('parent_of','partner_of','supplier_of','coalition_member','acquired','other')),
  valid_from      date NOT NULL,
  valid_to        date,
  certainty       text NOT NULL DEFAULT 'declared' CHECK (certainty IN ('declared','inferred')),
  inference_basis text,
  evidence_id     uuid NOT NULL REFERENCES evidence(id),
  observed_at     timestamptz NOT NULL,
  validated_at    timestamptz NOT NULL,
  CHECK (from_org_id <> to_org_id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (certainty = 'declared' OR inference_basis IS NOT NULL),
  UNIQUE (from_org_id, to_org_id, relation_type, valid_from)
);

-- Organograma: linha de reporte entre cargos. Inferida aparece rotulada, nunca como fato.
CREATE TABLE org_chart_edge (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  superior_role_id   uuid NOT NULL REFERENCES role_assignment(id),
  subordinate_role_id uuid NOT NULL REFERENCES role_assignment(id),
  valid_from         date NOT NULL,
  valid_to           date,
  certainty          text NOT NULL CHECK (certainty IN ('declared','inferred')),
  inference_basis    text,
  evidence_id        uuid NOT NULL REFERENCES evidence(id),
  observed_at        timestamptz NOT NULL,
  validated_at       timestamptz NOT NULL,
  CHECK (superior_role_id <> subordinate_role_id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (certainty = 'declared' OR inference_basis IS NOT NULL),
  UNIQUE (superior_role_id, subordinate_role_id, valid_from)
);

-- Loyalty Moves: mudança detectada a partir de fontes. Nunca publicada sem revisão.
CREATE TABLE move (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid NOT NULL REFERENCES person(id),
  kind             text NOT NULL CHECK (kind IN ('appointment','departure','title_change','org_change')),
  basis            text NOT NULL CHECK (basis IN ('announcement','observed_diff')),
  from_role_id     uuid REFERENCES role_assignment(id),
  to_role_id       uuid REFERENCES role_assignment(id),
  effective_date   date,                    -- só preenchida quando a fonte declara a data
  observed_on      date NOT NULL,
  evidence_id      uuid NOT NULL REFERENCES evidence(id),
  status           text NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','confirmed','rejected')),
  detected_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_role_id IS NOT NULL OR to_role_id IS NOT NULL),
  UNIQUE (person_id, kind, from_role_id, to_role_id)
);
CREATE INDEX move_person_idx ON move (person_id);

CREATE TABLE watchlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  owner_ref  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE watchlist_item (
  watchlist_id uuid NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type IN ('organization','person')),
  entity_id    uuid NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, entity_type, entity_id)
);

-- Alerta: nasce 'pending_review'; só vira 'approved' por revisão registrada (fluxo de revisão de alertas).
CREATE TABLE alert (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlist(id) ON DELETE CASCADE,
  move_id      uuid NOT NULL REFERENCES move(id),
  status       text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected')),
  reviewed_by  text,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'pending_review' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  UNIQUE (watchlist_id, move_id)
);

-- Pedido de titular (WF19): acesso, retificação, supressão.
CREATE TABLE data_subject_request (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES person(id),
  kind        text NOT NULL CHECK (kind IN ('access','rectification','suppression')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','denied')),
  note        text,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);

-- Arestas do grafo (pessoa–organização, organização–organização, pessoa–pessoa [hierarquia]).
-- Pessoa suprimida some do grafo. Cada aresta carrega certainty, evidência e datas.
CREATE VIEW graph_edge AS
  SELECT 'person'::text AS src_type, r.person_id AS src_id, 'organization'::text AS dst_type, r.organization_id AS dst_id,
         'holds_role'::text AS edge_kind, r.id AS edge_id, r.valid_from, r.valid_to, r.certainty,
         r.evidence_id, r.observed_at, r.validated_at, r.title AS label
    FROM role_assignment r JOIN person p ON p.id = r.person_id AND p.suppressed_at IS NULL
  UNION ALL
  SELECT 'organization', o.from_org_id, 'organization', o.to_org_id, o.relation_type, o.id, o.valid_from, o.valid_to,
         o.certainty, o.evidence_id, o.observed_at, o.validated_at, o.relation_type
    FROM org_relation o
  UNION ALL
  SELECT 'person', sup.person_id, 'person', sub.person_id, 'reports_line', e.id, e.valid_from, e.valid_to,
         e.certainty, e.evidence_id, e.observed_at, e.validated_at, 'superior_of'
    FROM org_chart_edge e
    JOIN role_assignment sup ON sup.id = e.superior_role_id
    JOIN role_assignment sub ON sub.id = e.subordinate_role_id
    JOIN person ps ON ps.id = sup.person_id AND ps.suppressed_at IS NULL
    JOIN person pb ON pb.id = sub.person_id AND pb.suppressed_at IS NULL;

-- Visão de organograma com rótulo de certeza para renderização: inferida NUNCA como fato.
CREATE VIEW org_chart_view AS
  SELECT e.id, e.organization_id,
         sup.person_id AS superior_person_id, ps.full_name AS superior_name, sup.title AS superior_title,
         sub.person_id AS subordinate_person_id, pb.full_name AS subordinate_name, sub.title AS subordinate_title,
         e.valid_from, e.valid_to, e.certainty,
         CASE WHEN e.certainty = 'declared' THEN 'fato (fonte declara)'
              ELSE 'inferido — não confirmado' END AS display_label,
         e.inference_basis, e.evidence_id, e.observed_at, e.validated_at
    FROM org_chart_edge e
    JOIN role_assignment sup ON sup.id = e.superior_role_id
    JOIN role_assignment sub ON sub.id = e.subordinate_role_id
    JOIN person ps ON ps.id = sup.person_id AND ps.suppressed_at IS NULL
    JOIN person pb ON pb.id = sub.person_id AND pb.suppressed_at IS NULL;
