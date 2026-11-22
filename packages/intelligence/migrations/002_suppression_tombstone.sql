-- Supressão a pedido do titular (WF19): impede reingestão por identificadores estáveis.
-- Guardamos apenas HASHES (sha256 de texto normalizado), nunca o nome em claro.
-- Três chaves independentes (basta uma casar para bloquear):
--   profile_url : URL pública de perfil
--   name_org    : nome normalizado + organização (qualquer fonte)
--   name_source : nome normalizado + domínio da fonte (qualquer organização)
SET search_path TO intelligence, public;

CREATE TABLE suppression_tombstone (
  key_kind   text NOT NULL CHECK (key_kind IN ('profile_url','name_org','name_source')),
  key_hash   text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  request_id uuid REFERENCES data_subject_request(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_kind, key_hash)
);

CREATE FUNCTION tombstone_hash(kind text, a text, b text DEFAULT '') RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('ln-intel-tombstone/1|' || kind || '|' || lower(coalesce(a,'')) || '|' || lower(coalesce(b,'')), 'UTF8')), 'hex')
$$;

-- Domínio da fonte (sem www.), para a chave name_source.
CREATE FUNCTION source_host(url text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(substring(url from '^https?://([^/:?#]+)')), '^www\.', '')
$$;
