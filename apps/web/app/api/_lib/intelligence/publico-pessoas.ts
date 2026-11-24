// Leitura PÚBLICA de pessoas, cargos e Moves para o Portal (contrato v1 do Frontend 2, no padrão do de empresas). Regras:
//  - sem login; envelope `{ data, total, disponivel }`; `disponivel` = flag `intelligencePessoas` (J-01);
//  - flag DESLIGADA: lista e moves = 200 com `data: []`, `total: 0`, `disponivel: false` (o portal mostra "indisponível por enquanto", não erro); detalhe = 404;
//  - só cargo `declared` (o "a confirmar", inferido de fonte secundária, nunca sai), só Move `confirmed`, só quando as leituras de antes e depois são declaradas,
//    pessoa suprimida nunca sai; nunca `excerpt`, hash de conteúdo nem citação;
//  - só nome, cargo e empresa, com fonte, data de coleta e de validação (P4);
//  - decisões da fila do titular (DP-38) valem aqui: pessoa/cargo/Move removidos somem (perfil 404, fora de listas e Moves) e correções sobrepõem campos (./titular-publico).
import { z } from 'zod';
import { json, queryObject, type RouteFn } from '../http';
import { hoje } from '../midia';
import { intelDb } from './index';
import { carregarEfeitos, type EfeitosPublicos } from './titular-publico';

const S = 'intelligence';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Rotas que trazem pessoa: nunca em cache compartilhado (PM-2026-11-23-O, achado (c) do QA 1): uma remoção pedida pelo titular (DP-38) vale na próxima requisição,
// sem a borda servir a versão antiga por max-age + stale-while-revalidate. Vale também para a resposta de flag desligada.
const CACHE = { 'cache-control': 'private, no-store' } as const;
const iso = (d: unknown) => new Date(d as string | number | Date).toISOString();
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`).toLowerCase()}%`;
// minúsculas, como no restante do Intelligence e no contrato do Portal; o envelope de erro do app exige maiúsculas, então responde-se direto
const fail = (status: number, code: string, message: string, details?: unknown) =>
  json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status, { 'cache-control': 'no-store' });
const fonte = (r: { ev_name: string; ev_url: string; ev_retrieved: string }) => ({ nome: r.ev_name, url: r.ev_url, coletadoEm: iso(r.ev_retrieved) });
const off = () => json({ data: [], total: 0, disponivel: false }, 200, CACHE);
const ligada = (c: Parameters<RouteFn>[1]) => c.deps.flags.intelligencePessoas === true;

const Lista = z.object({
  q: z.string().trim().max(100).optional(),
  empresa: z.string().regex(UUID).optional(),
  pessoa: z.string().regex(UUID).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const parseQuery = (c: Parameters<RouteFn>[1]) => Lista.safeParse(queryObject(c.url));
const badQuery = (e: z.ZodError) => fail(400, 'invalid_input', 'Parâmetros inválidos.', e.issues.map((i) => i.path.join('.') || '(raiz)'));

type CargoRow = {
  id: string; person_id: string; title: string; org_id: string; org_nome: string; valid_from: string; valid_to: string | null; validated_at: string;
  ev_name: string; ev_url: string; ev_retrieved: string; is_mock: boolean;
};
const cargo = (r: CargoRow, ef: EfeitosPublicos) => {
  const periodo = ef.campo('cargo', r.id, 'periodo');
  return {
    id: r.id, titulo: ef.campo('cargo', r.id, 'cargo', 'titulo') ?? r.title, empresa: { id: r.org_id, nome: ef.campo('cargo', r.id, 'empresa') ?? r.org_nome },
    vigenteDesde: r.valid_from, vigenteAte: r.valid_to, validadoEm: iso(r.validated_at), fonte: fonte(r), mock: r.is_mock,
    ...(periodo ? { periodo } : {}), ...(ef.corrigido('cargo', r.id) ? { corrigidoPeloTitular: true } : {}),
  };
};
/** Cargos DECLARADOS de pessoas (não suprimidas), com a organização e a fonte. */
const CARGOS = (extra: string) => `
  SELECT r.id, r.person_id, r.title, o.id AS org_id, coalesce(o.trade_name, o.legal_name) AS org_nome, r.valid_from::text, r.valid_to::text, r.validated_at,
         ev.source_name AS ev_name, ev.source_url AS ev_url, ev.retrieved_at AS ev_retrieved, ev.is_mock
    FROM ${S}.role_assignment r
    JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
    JOIN ${S}.organization o ON o.id = r.organization_id
    JOIN ${S}.evidence ev ON ev.id = r.evidence_id
   WHERE r.certainty = 'declared' ${extra}
   ORDER BY r.valid_from DESC, r.title, r.id`;
// vigente hoje: sem fim ou fim no futuro (mesma regra das relações de empresas)
const VIGENTE = `AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to > $2::date)`;

// ---------- pessoas ----------
export const publicListPessoas: RouteFn = async (_req, c) => {
  const q = parseQuery(c);
  if (!q.success) return badQuery(q.error);
  if (!ligada(c)) return off();
  const { q: busca, empresa, limit, offset } = q.data;
  const db = intelDb(c.deps.db);
  const asOf = hoje(c.deps.now());
  const term = busca ? like(busca) : null;
  const ef = await carregarEfeitos(c.deps.db);
  // pessoa (não removida a pedido do titular) com ao menos um cargo declarado (não removido) (e, com `empresa`, vigente nessa empresa)
  const FROM = `
    FROM ${S}.person p JOIN ${S}.evidence pev ON pev.id = p.evidence_id
   WHERE p.suppressed_at IS NULL AND p.id::text <> ALL($4::text[]) AND ($1::text IS NULL OR lower(p.full_name) LIKE $1 OR p.normalized_name LIKE $1)
     AND EXISTS (SELECT 1 FROM ${S}.role_assignment r WHERE r.person_id = p.id AND r.certainty = 'declared' AND r.id::text <> ALL($5::text[])
                  AND ($3::uuid IS NULL OR (r.organization_id = $3 AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to > $2::date))))`;
  const base = [term, asOf, empresa ?? null, ef.pessoas, ef.cargos];
  const people = await db.query<{ id: string; full_name: string; is_mock: boolean }>(
    `SELECT p.id, p.full_name, pev.is_mock${FROM} ORDER BY p.full_name, p.id LIMIT $6 OFFSET $7`,
    [...base, limit, offset],
  );
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n${FROM}`, base);
  const ids = people.rows.map((p) => p.id);
  const cargos = ids.length ? (await db.query<CargoRow>(CARGOS(`AND r.person_id = ANY($1::uuid[]) ${VIGENTE}`), [ids, asOf])).rows.filter((r) => !ef.cargoOculto(r.id)) : [];
  const byPerson = new Map<string, ReturnType<typeof cargo>[]>();
  for (const r of cargos) byPerson.set(r.person_id, [...(byPerson.get(r.person_id) ?? []), cargo(r, ef)]);
  return json(
    {
      data: people.rows.map((p) => ({
        id: p.id, nome: ef.campo('pessoa', p.id, 'nome') ?? p.full_name, cargos: byPerson.get(p.id) ?? [], mock: p.is_mock, ...(ef.corrigido('pessoa', p.id) ? { corrigidoPeloTitular: true } : {}),
      })),
      total: total.rows[0]?.n ?? 0,
      disponivel: true,
    },
    200,
    CACHE,
  );
};

// ---------- moves ----------
type MoveRow = {
  id: string; kind: string; basis: string; person_id: string; person_name: string; effective_date: string | null; observed_on: string; is_mock: boolean; from_role_id: string | null; to_role_id: string | null;
};
type Leitura = { titulo: string; empresa: { id: string; nome: string }; vigenteDesde: string; vigenteAte: string | null; validadoEm: string; fonte: ReturnType<typeof fonte> };

/** Move CONFIRMADO cujas leituras (antes/depois), quando existem, são declaradas e de pessoa não suprimida. */
const MOVE_FROM = `
    FROM ${S}.move m
    JOIN ${S}.person p ON p.id = m.person_id AND p.suppressed_at IS NULL
    JOIN ${S}.evidence mev ON mev.id = m.evidence_id
    LEFT JOIN ${S}.role_assignment fr ON fr.id = m.from_role_id
    LEFT JOIN ${S}.role_assignment tr ON tr.id = m.to_role_id
   WHERE m.status = 'confirmed'
     AND (fr.id IS NULL OR fr.certainty = 'declared') AND (tr.id IS NULL OR tr.certainty = 'declared')
     AND ($1::uuid IS NULL OR m.person_id = $1)
     AND ($2::uuid IS NULL OR fr.organization_id = $2 OR tr.organization_id = $2)
     AND ($3::uuid IS NULL OR m.id = $3)
     AND m.person_id::text <> ALL($4::text[]) AND m.id::text <> ALL($5::text[])
     AND (fr.id IS NULL OR fr.id::text <> ALL($6::text[])) AND (tr.id IS NULL OR tr.id::text <> ALL($6::text[]))`;

async function moves(db: ReturnType<typeof intelDb>, ef: EfeitosPublicos, f: { pessoa?: string; empresa?: string; id?: string }, limit: number, offset: number) {
  const filtro = [f.pessoa ?? null, f.empresa ?? null, f.id ?? null, ef.pessoas, ef.moves, ef.cargos];
  const rows = await db.query<MoveRow>(
    `SELECT m.id, m.kind, m.basis, m.person_id, p.full_name AS person_name, m.effective_date::text, m.observed_on::text, mev.is_mock, m.from_role_id, m.to_role_id${MOVE_FROM}
      ORDER BY m.observed_on DESC, m.detected_at DESC, m.id LIMIT $7 OFFSET $8`,
    [...filtro, limit, offset],
  );
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n${MOVE_FROM}`, filtro);
  const roleIds = [...new Set(rows.rows.flatMap((m) => [m.from_role_id, m.to_role_id]).filter((x): x is string => !!x))];
  const read = new Map<string, Leitura>();
  if (roleIds.length) {
    const rr = await db.query<CargoRow>(CARGOS('AND r.id = ANY($1::uuid[])'), [roleIds]);
    for (const r of rr.rows) {
      const c = cargo(r, ef);
      read.set(r.id, { titulo: c.titulo, empresa: c.empresa, vigenteDesde: c.vigenteDesde, vigenteAte: c.vigenteAte, validadoEm: c.validadoEm, fonte: c.fonte });
    }
  }
  const data = rows.rows.map((m) => ({
    id: m.id, tipo: m.kind, base: m.basis, pessoa: { id: m.person_id, nome: ef.campo('pessoa', m.person_id, 'nome') ?? m.person_name }, dataEfetiva: m.effective_date, observadoEm: m.observed_on,
    antes: m.from_role_id ? read.get(m.from_role_id) ?? null : null, depois: m.to_role_id ? read.get(m.to_role_id) ?? null : null, mock: m.is_mock,
  }));
  return { data, total: total.rows[0]?.n ?? 0 };
}

export const publicListMoves: RouteFn = async (_req, c) => {
  const q = parseQuery(c);
  if (!q.success) return badQuery(q.error);
  if (!ligada(c)) return off();
  const r = await moves(intelDb(c.deps.db), await carregarEfeitos(c.deps.db), { pessoa: q.data.pessoa, empresa: q.data.empresa }, q.data.limit, q.data.offset);
  return json({ ...r, disponivel: true }, 200, CACHE);
};

export const publicGetMove: RouteFn = async (_req, c) => {
  const id = c.params.id ?? '';
  if (!UUID.test(id)) return fail(400, 'invalid_input', 'id deve ser UUID.');
  if (!ligada(c)) return fail(404, 'not_found', 'Move não encontrado.');
  const r = await moves(intelDb(c.deps.db), await carregarEfeitos(c.deps.db), { id }, 1, 0);
  if (!r.data[0]) return fail(404, 'not_found', 'Move não encontrado.');
  return json({ data: r.data[0] }, 200, CACHE);
};

// ---------- pessoa (detalhe) ----------
export const publicGetPessoa: RouteFn = async (_req, c) => {
  const id = c.params.id ?? '';
  if (!UUID.test(id)) return fail(400, 'invalid_input', 'id deve ser UUID.');
  if (!ligada(c)) return fail(404, 'not_found', 'Pessoa não encontrada.');
  const db = intelDb(c.deps.db);
  const asOf = hoje(c.deps.now());
  const ef = await carregarEfeitos(c.deps.db);
  if (ef.pessoaOculta(id)) return fail(404, 'not_found', 'Pessoa não encontrada.'); // removida a pedido do titular (DP-38)
  const p = await db.query<{ id: string; full_name: string; public_profile_url: string | null; is_mock: boolean; ev_name: string; ev_url: string; ev_retrieved: string }>(
    `SELECT p.id, p.full_name, p.public_profile_url, pev.is_mock, pev.source_name AS ev_name, pev.source_url AS ev_url, pev.retrieved_at AS ev_retrieved
       FROM ${S}.person p JOIN ${S}.evidence pev ON pev.id = p.evidence_id WHERE p.id = $1 AND p.suppressed_at IS NULL`,
    [id],
  );
  const pessoa = p.rows[0];
  const todos = pessoa ? (await db.query<CargoRow>(CARGOS('AND r.person_id = $1'), [id])).rows.filter((r) => !ef.cargoOculto(r.id)) : [];
  // sem cargo declarado a pessoa não aparece (um cargo só inferido, de fonte secundária, não sustenta a página)
  if (!pessoa || todos.length === 0) return fail(404, 'not_found', 'Pessoa não encontrada.');
  const atual = (r: CargoRow) => r.valid_from <= asOf && (r.valid_to === null || r.valid_to > asOf);
  const m = await moves(db, ef, { pessoa: id }, 100, 0);
  return json(
    {
      data: {
        id: pessoa.id, nome: ef.campo('pessoa', id, 'nome') ?? pessoa.full_name, ...(ef.corrigido('pessoa', id) ? { corrigidoPeloTitular: true } : {}), perfilPublico: pessoa.public_profile_url, fonte: fonte(pessoa), mock: pessoa.is_mock,
        cargosAtuais: todos.filter(atual).map((r) => cargo(r, ef)),
        historico: todos.filter((r) => !atual(r)).map((r) => cargo(r, ef)),
        moves: m.data,
      },
      disponivel: true,
    },
    200,
    CACHE,
  );
};
