// Cargos do Entity Intelligence no Studio: a fila "a confirmar" (cargo lido de fonte SECUNDÁRIA — LinkedIn/The Org — entra como INFERIDO e nunca vira fato
// nem Move sem confirmação oficial; MOVES_MODEL.md e INGESTION_CONTRACT.md do Data), a confirmação com a página OFICIAL e o descarte.
//  - nível da fonte por cargo: `official` = cargo declarado (fonte oficial) · `secondary` = cargo inferido (a confirmar);
//  - confirmar NÃO gera Move (o contrato do Data: leitura oficial de um cargo "a confirmar" só o confirma): a URL oficial tem de ser https, NUNCA de rede
//    profissional/organograma e do MESMO site (host ou subdomínio) da fonte oficial já cadastrada da empresa (a evidência da própria organização ou de um
//    cargo declarado dela). O servidor não lê a página: quem confirma é a pessoa (editor ou superior), com auditoria;
//  - descartar fecha o cargo inferido (nunca apaga: o motivo fica no próprio registro e na auditoria) e ele sai da fila.
import { randomUUID } from 'node:crypto';
import { SECONDARY_HOSTS, type ApiResult, type Db as IntelDb } from '@ln/intelligence';

const S = 'intelligence';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ok = <T>(body: T, status = 200): ApiResult<T> => ({ status, body });
const fail = (status: number, code: string, message: string): ApiResult<never> => ({ status, body: { error: { code, message } } });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const intIn = (v: unknown, def: number, max: number): number => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : def;
  return Math.min(Math.max(n, 0), max);
};

interface RoleRow {
  role_id: string; person_id: string; person_name: string; organization_id: string; organization: string; title: string; certainty: 'declared' | 'inferred';
  valid_from: string; validated_at: string; source_url: string; source_name: string; retrieved_at: string; is_mock: boolean;
}

/** Cargo descartado fica fechado com este marcador em `inference_basis` e sai da fila. */
const DESCARTADO = 'descartado:';

export async function listRolesHandler(db: IntelDb, _actor: string, input: unknown): Promise<ApiResult> {
  const i = isObj(input) ? input : {};
  const certainty = i.certainty === undefined ? null : i.certainty;
  if (certainty !== null && certainty !== 'inferred' && certainty !== 'declared') return fail(400, 'invalid_input', 'certainty deve ser inferred ou declared');
  const org = i.organizationId === undefined ? null : i.organizationId;
  if (org !== null && !(typeof org === 'string' && UUID.test(org))) return fail(400, 'invalid_input', 'organizationId deve ser UUID');
  const q = typeof i.q === 'string' && i.q.trim() ? i.q.trim().slice(0, 100) : null;
  if (typeof i.q === 'string' && i.q.trim().length > 100) return fail(400, 'invalid_input', 'q aceita até 100 caracteres');
  const term = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`).toLowerCase()}%` : null;
  const limit = Math.max(1, intIn(i.limit, 50, 200));
  const offset = intIn(i.offset, 0, 100_000);
  const FROM = `
       FROM ${S}.role_assignment r
       JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
       JOIN ${S}.organization o ON o.id = r.organization_id
       JOIN ${S}.evidence ev ON ev.id = r.evidence_id
      WHERE r.valid_to IS NULL
        AND ($1::text IS NULL OR r.certainty = $1)
        AND ($2::uuid IS NULL OR r.organization_id = $2)
        AND ($3::text IS NULL OR lower(p.full_name) LIKE $3 OR lower(r.title) LIKE $3 OR lower(o.legal_name) LIKE $3 OR lower(coalesce(o.trade_name, '')) LIKE $3)`;
  const rows = await db.query<RoleRow>(
    `SELECT r.id AS role_id, p.id AS person_id, p.full_name AS person_name, o.id AS organization_id, coalesce(o.trade_name, o.legal_name) AS organization,
            r.title, r.certainty, r.valid_from::text, r.validated_at, ev.source_url, ev.source_name, ev.retrieved_at, ev.is_mock${FROM}
      ORDER BY o.legal_name, p.full_name, r.title LIMIT $4 OFFSET $5`,
    [certainty, org, term, limit, offset],
  );
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n${FROM}`, [certainty, org, term]);
  return ok({
    items: rows.rows.map((r) => ({
      role_id: r.role_id, person_id: r.person_id, person_name: r.person_name, organization_id: r.organization_id, organization: r.organization, title: r.title,
      certainty: r.certainty,
      // oficial = declarado; secundária = inferido ("a confirmar")
      source_level: r.certainty === 'declared' ? 'official' : 'secondary',
      valid_from: r.valid_from, validated_at: new Date(r.validated_at).toISOString(),
      evidence: { source_url: r.source_url, source_name: r.source_name, retrieved_at: new Date(r.retrieved_at).toISOString(), is_mock: r.is_mock },
    })),
    total: total.rows[0]?.n ?? 0,
    limit,
    offset,
  });
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const sameSite = (candidate: string, official: string): boolean => candidate === official || candidate.endsWith(`.${official}`);

async function audit(db: IntelDb, actor: string, action: string, roleId: string, detalhe: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO public.audit_log (id, at, actor_id, actor_role, action, resource, resource_id, detalhe) VALUES ($1, now(), $2, NULL, $3, 'intelligence', $4, $5::jsonb)`,
    [randomUUID(), actor || null, action, roleId, JSON.stringify(detalhe)],
  );
}

/** Confirma um cargo "a confirmar" com a URL de uma página OFICIAL: vira declarado, com a evidência nova, sem gerar Move. */
export async function confirmRoleHandler(db: IntelDb, actor: string, input: unknown): Promise<ApiResult> {
  const i = isObj(input) ? input : {};
  const id = i.id;
  if (typeof id !== 'string' || !UUID.test(id)) return fail(400, 'invalid_input', 'id do cargo deve ser UUID');
  const raw = i.officialUrl;
  if (typeof raw !== 'string' || raw.length > 500) return fail(400, 'invalid_input', 'officialUrl obrigatória (até 500 caracteres)');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(400, 'invalid_input', 'officialUrl inválida');
  }
  if (url.protocol !== 'https:' || url.username || url.password) return fail(400, 'invalid_input', 'a URL oficial precisa ser https, sem credenciais');
  const host = url.hostname.toLowerCase();
  if (SECONDARY_HOSTS.test(host)) return fail(422, 'SECONDARY_SOURCE', 'LinkedIn e The Org são fonte secundária: não confirmam cargo');

  const cur = await db.query<{ organization_id: string; certainty: string; valid_to: string | null; person_name: string; title: string; org_ev_url: string }>(
    `SELECT r.organization_id, r.certainty, r.valid_to::text, p.full_name AS person_name, r.title, oev.source_url AS org_ev_url
       FROM ${S}.role_assignment r
       JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
       JOIN ${S}.organization o ON o.id = r.organization_id JOIN ${S}.evidence oev ON oev.id = o.evidence_id
      WHERE r.id = $1`,
    [id],
  );
  const role = cur.rows[0];
  if (!role) return fail(404, 'not_found', 'cargo não encontrado');
  if (role.certainty !== 'inferred' || role.valid_to !== null) return fail(409, 'not_pending', 'só cargo aberto e "a confirmar" pode ser confirmado');

  // a página precisa ser do site OFICIAL já cadastrado da empresa: o da própria organização ou o de um cargo declarado dela
  const officialHosts = new Set<string>([hostOf(role.org_ev_url)]);
  const declared = await db.query<{ source_url: string }>(
    `SELECT ev.source_url FROM ${S}.role_assignment r JOIN ${S}.evidence ev ON ev.id = r.evidence_id WHERE r.organization_id = $1 AND r.certainty = 'declared'`,
    [role.organization_id],
  );
  for (const d of declared.rows) officialHosts.add(hostOf(d.source_url));
  officialHosts.delete('');
  for (const h of [...officialHosts]) if (SECONDARY_HOSTS.test(h)) officialHosts.delete(h);
  if (![...officialHosts].some((h) => sameSite(host, h))) {
    return fail(422, 'NOT_OFFICIAL_SOURCE', 'a página não é do site oficial cadastrado desta empresa');
  }

  // UMA instrução (evidência + atualização do cargo): atômica; só atualiza se o cargo ainda é "a confirmar" e aberto
  const done = await db.query<{ id: string }>(
    `WITH ev AS (
       INSERT INTO ${S}.evidence (source_url, source_name, source_class, retrieved_at, is_mock)
       VALUES ($2, $3, 'public', now(), false) RETURNING id)
     UPDATE ${S}.role_assignment SET certainty = 'declared', inference_basis = NULL, evidence_id = (SELECT id FROM ev), validated_at = now()
      WHERE id = $1 AND certainty = 'inferred' AND valid_to IS NULL RETURNING id`,
    [id, url.toString(), `Confirmação com a página oficial (${host})`],
  );
  if (!done.rows[0]) return fail(409, 'not_pending', 'o cargo mudou durante a operação; releia a fila');
  await audit(db, actor, 'intelligence.cargo_confirmado', id, { pessoa: role.person_name, cargo: role.title, fonteOficial: host });
  return ok({ id, certainty: 'declared', source_level: 'official' });
}

/** Descarta um cargo "a confirmar": fecha o cargo (valid_to = valid_from), guarda o motivo e o tira da fila. Nunca apaga. */
export async function discardRoleHandler(db: IntelDb, actor: string, input: unknown): Promise<ApiResult> {
  const i = isObj(input) ? input : {};
  const id = i.id;
  if (typeof id !== 'string' || !UUID.test(id)) return fail(400, 'invalid_input', 'id do cargo deve ser UUID');
  const motivo = typeof i.motivo === 'string' ? i.motivo.trim() : '';
  if (motivo.length < 5 || motivo.length > 300) return fail(400, 'invalid_input', 'motivo obrigatório (5 a 300 caracteres)');
  const cur = await db.query<{ certainty: string; valid_to: string | null; person_name: string; title: string }>(
    `SELECT r.certainty, r.valid_to::text, p.full_name AS person_name, r.title FROM ${S}.role_assignment r JOIN ${S}.person p ON p.id = r.person_id WHERE r.id = $1`,
    [id],
  );
  const role = cur.rows[0];
  if (!role) return fail(404, 'not_found', 'cargo não encontrado');
  if (role.certainty !== 'inferred' || role.valid_to !== null) return fail(409, 'not_pending', 'só cargo aberto e "a confirmar" pode ser descartado');
  const done = await db.query<{ id: string }>(
    `UPDATE ${S}.role_assignment SET valid_to = valid_from, inference_basis = $2 WHERE id = $1 AND certainty = 'inferred' AND valid_to IS NULL RETURNING id`,
    [id, `${DESCARTADO} ${motivo}`],
  );
  if (!done.rows[0]) return fail(409, 'not_pending', 'o cargo mudou durante a operação; releia a fila');
  await audit(db, actor, 'intelligence.cargo_descartado', id, { pessoa: role.person_name, cargo: role.title, motivo });
  return ok({ id, discarded: true });
}
