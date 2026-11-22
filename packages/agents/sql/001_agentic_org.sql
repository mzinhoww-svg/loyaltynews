-- Loyalty News — organização agêntica (Frente 07). PostgreSQL.
-- Memória setorial por editoria + rituais (execuções, atas, decisões, tarefas, insumos).
-- Dono do diretório de migrações: packages/db (Chief Architect). Este arquivo é a proposta de
-- migração da Frente 07; incorporar em packages/db preservando nomes e restrições.
-- IDs de agentes são texto validado pela aplicação contra o registro de perfis (o registro é
-- configuração versionada em código, não tabela: ADR-004).

CREATE TABLE IF NOT EXISTS sector_memory (
  id              uuid        PRIMARY KEY,
  editoria        text        NOT NULL CHECK (editoria IN ('mercado','programas','pontos','bancos','varejo','travel','tech','crm','global','regulacao')),
  kind            text        NOT NULL CHECK (kind IN ('sources','glossary','style','lessons','open_threads','decision')),
  key             text        NOT NULL,
  version         integer     NOT NULL CHECK (version >= 1),
  content         jsonb       NOT NULL,
  source_refs     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  author_agent_id text        NOT NULL,
  created_at      timestamptz NOT NULL,
  UNIQUE (editoria, key, version)
);
CREATE INDEX IF NOT EXISTS sector_memory_editoria_kind_idx ON sector_memory (editoria, kind);

CREATE TABLE IF NOT EXISTS meeting_runs (
  id                   uuid        PRIMARY KEY,
  meeting_id           text        NOT NULL,
  local_date           date        NOT NULL,
  instance             text        NOT NULL DEFAULT '',  -- '' = agendado; id do evento p/ X-incident
  scheduled_for        timestamptz NOT NULL,
  executed_at          timestamptz NOT NULL,
  status               text        NOT NULL CHECK (status IN ('completed','status_only','waiting')),
  reason               text        CHECK (reason IS NULL OR reason IN ('no_inputs_or_decisions','quorum_not_met','recovery_window_expired','host_off_previous_day')),
  route                text        NOT NULL,
  delay_minutes        integer     NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  model_calls          integer     NOT NULL DEFAULT 0 CHECK (model_calls >= 0),
  recovered            boolean     NOT NULL DEFAULT false,
  chair                text        NOT NULL,
  participants_present jsonb       NOT NULL DEFAULT '[]'::jsonb,
  participants_absent  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  quorum_minimum       integer     NOT NULL,
  -- idempotência (recovery_policy.idempotency_key = meeting_id + local_date; + instance p/ eventos)
  UNIQUE (meeting_id, local_date, instance),
  -- ritual com status_only precisa de motivo; ritual concluído não tem motivo
  CHECK ((status = 'status_only' AND reason IS NOT NULL) OR (status <> 'status_only' AND reason IS NULL))
);

CREATE TABLE IF NOT EXISTS meeting_minutes (
  run_id        uuid  PRIMARY KEY REFERENCES meeting_runs (id),
  summary       text  NOT NULL,
  blockers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  outputs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes         jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS meeting_decisions (
  id                   uuid    PRIMARY KEY,
  run_id               uuid    NOT NULL REFERENCES meeting_runs (id),
  text                 text    NOT NULL,
  proposed_by          text    NOT NULL,
  authority            text    NOT NULL,
  status               text    NOT NULL CHECK (status IN ('approved','pending_human','rejected_invalid_authority')),
  needs_human_approval boolean NOT NULL DEFAULT false,
  evidence_refs        jsonb   NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS meeting_decisions_run_idx ON meeting_decisions (run_id);

CREATE TABLE IF NOT EXISTS action_items (
  id             uuid        PRIMARY KEY,
  decision_id    uuid        NOT NULL REFERENCES meeting_decisions (id),
  run_id         uuid        NOT NULL REFERENCES meeting_runs (id),
  title          text        NOT NULL,
  owner_agent_id text        NOT NULL,
  due_date       date        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('open','done','escalated')),
  created_at     timestamptz NOT NULL,
  closed_at      timestamptz,
  evidence_ref   text,
  -- WF16: conclusão exige evidência verificável
  CHECK (status <> 'done' OR (closed_at IS NOT NULL AND evidence_ref IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS action_items_owner_status_idx ON action_items (owner_agent_id, status);
CREATE INDEX IF NOT EXISTS action_items_due_idx ON action_items (due_date) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS meeting_inputs (
  meeting_id text  NOT NULL,
  local_date date  NOT NULL,
  instance   text  NOT NULL DEFAULT '',
  agent_id   text  NOT NULL,
  payload    jsonb NOT NULL,
  PRIMARY KEY (meeting_id, local_date, instance, agent_id)
);
