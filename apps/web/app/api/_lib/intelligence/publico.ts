// Leitura PÚBLICA do Intelligence para o Portal (contrato v1 do Frontend 2): lista e detalhe de empresas com relações DECLARADAS e fonte.
// Regras: sem login; só `certainty = 'declared'` e vigente hoje; NUNCA `excerpt`, `content_hash` ou citação; pessoas só com a flag
// `intelligencePessoas` (J-01) e, mesmo com ela, só nome, cargo e empresa com fonte (P4). Ausência de registro não prova inexistência.
// O schema `intelligence` não é do Drizzle: o acesso é por SQL qualificado, como no @ln/intelligence.
import { z } from 'zod';
import { json, queryObject, type RouteFn } from '../http';
import { hoje } from '../midia';
import { intelDb } from './index';

const S = 'intelligence';
const TIPOS = ['company', 'program', 'association', 'regulator', 'media', 'other'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE = { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } as const;

const Lista = z.object({
  tipo: z.enum(TIPOS).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

// Códigos em minúsculas, como no restante do Intelligence (@ln/intelligence) e no contrato do Portal; o envelope de erro do app exige maiúsculas, então responde-se direto.
const fail = (status: number, code: string, message: string, details?: unknown) =>
  json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status, { 'cache-control': 'no-store' });
const iso = (d: unknown) => new Date(d as string | number | Date).toISOString();
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`).toLowerCase()}%`;
const NOME = `coalesce(o.trade_name, o.legal_name)`;
const QFILTER = `($1::text IS NULL OR lower(o.legal_name) LIKE $1 OR lower(coalesce(o.trade_name, '')) LIKE $1 OR o.normalized_name LIKE $1)`;

export const publicListEmpresas: RouteFn = async (_req, c) => {
  const parsed = Lista.safeParse(queryObject(c.url));
  if (!parsed.success) return fail(400, 'invalid_input', 'Parâmetros inválidos.', parsed.error.issues.map((i) => i.path.join('.') || '(raiz)'));
  const { tipo, q, limit, offset } = parsed.data;
  const db = intelDb(c.deps.db);
  const term = q ? like(q) : null;
  const asOf = hoje(c.deps.now());
  const rows = await db.query<{ id: string; nome: string; legal_name: string; kind: string; retrieved_at: string; is_mock: boolean; relacoes: number }>(
    `SELECT o.id, ${NOME} AS nome, o.legal_name, o.kind, ev.retrieved_at, ev.is_mock,
            (SELECT count(*)::int FROM ${S}.org_relation x
              WHERE (x.from_org_id = o.id OR x.to_org_id = o.id) AND x.certainty = 'declared'
                AND x.valid_from <= $3::date AND (x.valid_to IS NULL OR x.valid_to > $3::date)) AS relacoes
       FROM ${S}.organization o JOIN ${S}.evidence ev ON ev.id = o.evidence_id
      WHERE ${QFILTER} AND ($2::text IS NULL OR o.kind = $2)
      ORDER BY ${NOME}, o.id LIMIT $4 OFFSET $5`,
    [term, tipo ?? null, asOf, limit, offset],
  );
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.organization o WHERE ${QFILTER} AND ($2::text IS NULL OR o.kind = $2)`, [term, tipo ?? null]);
  const tipos = await db.query<{ kind: string; n: number }>(`SELECT o.kind, count(*)::int AS n FROM ${S}.organization o WHERE ${QFILTER} GROUP BY o.kind ORDER BY o.kind`, [term]);
  return json(
    {
      data: rows.rows.map((r) => ({ id: r.id, nome: r.nome, nomeLegal: r.legal_name, tipo: r.kind, relacoes: r.relacoes, validadoEm: iso(r.retrieved_at), mock: r.is_mock })),
      total: total.rows[0]?.n ?? 0,
      tipos: tipos.rows.map((t) => ({ tipo: t.kind, total: t.n })),
    },
    200,
    CACHE,
  );
};

const fonte = (r: { ev_name: string; ev_url: string; ev_retrieved: string }) => ({ nome: r.ev_name, url: r.ev_url, coletadoEm: iso(r.ev_retrieved) });

export const publicGetEmpresa: RouteFn = async (_req, c) => {
  const id = c.params.id ?? '';
  if (!UUID.test(id)) return fail(400, 'invalid_input', 'id deve ser UUID.');
  const db = intelDb(c.deps.db);
  const asOf = hoje(c.deps.now());
  const org = await db.query<{ id: string; legal_name: string; trade_name: string | null; nome: string; kind: string; ev_name: string; ev_url: string; ev_retrieved: string; is_mock: boolean }>(
    `SELECT o.id, o.legal_name, o.trade_name, ${NOME} AS nome, o.kind, ev.source_name AS ev_name, ev.source_url AS ev_url, ev.retrieved_at AS ev_retrieved, ev.is_mock
       FROM ${S}.organization o JOIN ${S}.evidence ev ON ev.id = o.evidence_id WHERE o.id = $1`,
    [id],
  );
  const o = org.rows[0];
  if (!o) return fail(404, 'not_found', 'Empresa não encontrada.');
  const rel = await db.query<{
    id: string; relation_type: string; sentido: 'origem' | 'destino'; other_id: string; other_nome: string; other_kind: string; valid_from: string; validated_at: string;
    ev_name: string; ev_url: string; ev_retrieved: string; is_mock: boolean;
  }>(
    `SELECT x.id, x.relation_type, CASE WHEN x.from_org_id = $1 THEN 'origem' ELSE 'destino' END AS sentido,
            p.id AS other_id, coalesce(p.trade_name, p.legal_name) AS other_nome, p.kind AS other_kind, x.valid_from::text, x.validated_at,
            ev.source_name AS ev_name, ev.source_url AS ev_url, ev.retrieved_at AS ev_retrieved, ev.is_mock
       FROM ${S}.org_relation x
       JOIN ${S}.organization p ON p.id = CASE WHEN x.from_org_id = $1 THEN x.to_org_id ELSE x.from_org_id END
       JOIN ${S}.evidence ev ON ev.id = x.evidence_id
      WHERE (x.from_org_id = $1 OR x.to_org_id = $1) AND x.certainty = 'declared'
        AND x.valid_from <= $2::date AND (x.valid_to IS NULL OR x.valid_to > $2::date)
      ORDER BY coalesce(p.trade_name, p.legal_name), x.relation_type, x.id`,
    [id, asOf],
  );
  const pessoasLigadas = c.deps.flags.intelligencePessoas === true;
  const pessoas = pessoasLigadas
    ? (
        await db.query<{ person_id: string; full_name: string; title: string; valid_from: string; validated_at: string; ev_name: string; ev_url: string; ev_retrieved: string; is_mock: boolean }>(
          `SELECT p.id AS person_id, p.full_name, r.title, r.valid_from::text, r.validated_at,
                  ev.source_name AS ev_name, ev.source_url AS ev_url, ev.retrieved_at AS ev_retrieved, ev.is_mock
             FROM ${S}.role_assignment r
             JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
             JOIN ${S}.evidence ev ON ev.id = r.evidence_id
            WHERE r.organization_id = $1 AND r.certainty = 'declared' AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to > $2::date)
            ORDER BY p.full_name, r.title`,
          [id, asOf],
        )
      ).rows.map((r) => ({ id: r.person_id, nome: r.full_name, cargo: r.title, vigenteDesde: r.valid_from, validadoEm: iso(r.validated_at), mock: r.is_mock, fonte: fonte(r) }))
    : [];
  return json(
    {
      data: {
        id: o.id,
        nome: o.nome,
        nomeLegal: o.legal_name,
        tipo: o.kind,
        mock: o.is_mock,
        fonte: fonte(o),
        relacoes: rel.rows.map((r) => ({
          id: r.id,
          tipo: r.relation_type,
          sentido: r.sentido,
          empresa: { id: r.other_id, nome: r.other_nome, tipo: r.other_kind },
          vigenteDesde: r.valid_from,
          validadoEm: iso(r.validated_at),
          mock: r.is_mock,
          fonte: fonte(r),
        })),
        pessoas: { disponivel: pessoasLigadas, itens: pessoas },
      },
    },
    200,
    CACHE,
  );
};
