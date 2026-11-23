/**
 * Carga de conjuntos de dados verificados (intelligence-seed/1) no schema `intelligence`.
 *
 * O conjunto só entra se houver um RELATÓRIO DE VERIFICAÇÃO (scripts/verify-dataset.mjs) em que cada registro tem a
 * citação literal encontrada na página pública da fonte. Sem relatório, relatório de outro conjunto, fonte não
 * verificada ou citação não encontrada => o registro é RECUSADO (nunca carregado "por confiança").
 *
 * Regras de conteúdo (iguais às do produto):
 *  - Só organizações e relações corporativas DECLARADAS. Nada de pessoa (flag `intelligencePessoas`, J-01: pessoas só
 *    entram pelo contrato de ingestão role-observation/1) e nada de vínculo inferido ("sem vínculos presumidos").
 *  - Cada registro tem evidência (URL pública, data de coleta = data da verificação, hash do texto da página, citação)
 *    e data de validação (= data da verificação).
 *  - A vigência da relação começa na data da verificação (a fonte não declara a data do fato; não inventamos).
 *  - Idempotente: reexecutar não duplica; relação já existente só tem a validação renovada.
 *
 * Execução: `planSeedLoad` é só leitura (dry-run). `loadSeed` roda em transação: use uma conexão ÚNICA (pg.Client ou
 * PGlite), nunca um pool, pois BEGIN/COMMIT precisam da mesma sessão.
 */
import type { Db } from './db';
import { addEvidence, addOrgRelation, upsertOrganization } from './repo';
import { normalizeOrgName } from './normalize';
import type { Uuid } from './types';

export const SEED_SCHEMA_VERSION = 'intelligence-seed/1';

const ORG_KINDS = ['company', 'program', 'association', 'regulator', 'media', 'other'] as const;
const REL_TYPES = ['parent_of', 'partner_of', 'supplier_of', 'coalition_member', 'acquired', 'other'] as const;

/** method 'browser' = página que só renderiza com JavaScript; texto capturado pelo navegador do OpenBot em data/captures/<id>.json. */
export interface SeedSource { id: string; name: string; url: string; method?: 'http' | 'browser' }
export interface SeedOrganization { key: string; legalName: string; tradeName?: string; kind: (typeof ORG_KINDS)[number]; sourceId: string; quote: string; contextQuote?: string }
export interface SeedRelation { from: string; to: string; type: (typeof REL_TYPES)[number]; sourceId: string; quote: string; contextQuote?: string }
export interface SeedDataset {
  schemaVersion: typeof SEED_SCHEMA_VERSION;
  datasetId: string;
  description?: string;
  sources: SeedSource[];
  organizations: SeedOrganization[];
  relations: SeedRelation[];
  persons?: unknown[];
}

export interface VerificationReport {
  datasetId: string;
  verifiedAt: string;
  sources: { id: string; url: string; method?: string; status: string; http_status: number | null; fetched_at: string | null; content_sha256: string | null }[];
  records: { ref: string; source_id: string; quote_found: boolean }[];
}

export type RecordPlan = {
  ref: string;
  action: 'create' | 'exists' | 'rejected';
  reason?: string;
};
export interface LoadPlan {
  datasetId: string;
  ok: boolean; // false = há problema estrutural do conjunto; nada deve ser carregado
  issues: string[];
  records: RecordPlan[];
  counts: { create: number; exists: number; rejected: number };
}

export interface LoadManifest {
  datasetId: string;
  loadedAt: string;
  evidenceIds: Uuid[];
  organizationsCreated: Uuid[];
  relationsCreated: Uuid[];
  relationsRevalidated: Uuid[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const HTTPS = /^https:\/\/\S+$/i;

/** Validação estrutural do conjunto (sem rede, sem banco). */
export function validateSeed(x: unknown): string[] {
  const out: string[] = [];
  if (!isObj(x)) return ['conjunto deve ser um objeto'];
  if (x.schemaVersion !== SEED_SCHEMA_VERSION) out.push(`schemaVersion deve ser ${SEED_SCHEMA_VERSION}`);
  if (typeof x.datasetId !== 'string' || !/^[a-z0-9._-]{3,64}$/.test(x.datasetId)) out.push('datasetId inválido');
  const sources = Array.isArray(x.sources) ? x.sources : [];
  const sourceIds = new Set<string>();
  sources.forEach((s, i) => {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.name !== 'string' || !s.name.trim() || typeof s.url !== 'string' || !HTTPS.test(s.url)) out.push(`sources[${i}]: id, name e url https obrigatórios`);
    else if (sourceIds.has(s.id)) out.push(`sources[${i}]: id repetido`);
    else sourceIds.add(s.id);
  });
  const keys = new Set<string>();
  (Array.isArray(x.organizations) ? x.organizations : []).forEach((o, i) => {
    if (!isObj(o)) return void out.push(`organizations[${i}]: objeto esperado`);
    if (typeof o.key !== 'string' || !o.key) out.push(`organizations[${i}]: key obrigatória`);
    else if (keys.has(o.key)) out.push(`organizations[${i}]: key repetida`);
    else keys.add(o.key);
    if (typeof o.legalName !== 'string' || !o.legalName.trim()) out.push(`organizations[${i}]: legalName obrigatório`);
    if (!ORG_KINDS.includes(o.kind as never)) out.push(`organizations[${i}]: kind inválido`);
    if (typeof o.sourceId !== 'string' || !sourceIds.has(o.sourceId)) out.push(`organizations[${i}]: sourceId desconhecido`);
    if (typeof o.quote !== 'string' || o.quote.length < 20 || o.quote.length > 500) out.push(`organizations[${i}]: quote deve ter 20 a 500 caracteres`);
    out.push(...contextIssues(`organizations[${i}]`, o));
  });
  (Array.isArray(x.relations) ? x.relations : []).forEach((r, i) => {
    if (!isObj(r)) return void out.push(`relations[${i}]: objeto esperado`);
    if (typeof r.from !== 'string' || !keys.has(r.from) || typeof r.to !== 'string' || !keys.has(r.to) || r.from === r.to) out.push(`relations[${i}]: from/to devem ser chaves de organizações distintas`);
    if (!REL_TYPES.includes(r.type as never)) out.push(`relations[${i}]: type inválido`);
    if (typeof r.sourceId !== 'string' || !sourceIds.has(r.sourceId)) out.push(`relations[${i}]: sourceId desconhecido`);
    if (typeof r.quote !== 'string' || r.quote.length < 20 || r.quote.length > 500) out.push(`relations[${i}]: quote deve ter 20 a 500 caracteres`);
    out.push(...contextIssues(`relations[${i}]`, r));
    for (const k of Object.keys(r)) if (!['from', 'to', 'type', 'sourceId', 'quote', 'contextQuote'].includes(k)) out.push(`relations[${i}]: campo ${k} não permitido (inferência/certeza/data não se declaram aqui)`);
  });
  if (Array.isArray(x.persons) && x.persons.length) out.push('persons: não suportado em intelligence-seed/1 (pessoas só pelo contrato role-observation/1, com a flag intelligencePessoas)');
  return out;
}

/** contextQuote é opcional (ex.: título da lista "Empresas Associadas"); se existir, também precisa estar literalmente na página. */
function contextIssues(where: string, r: Record<string, unknown>): string[] {
  if (r.contextQuote === undefined) return [];
  if (typeof r.contextQuote !== 'string' || r.contextQuote.length < 20) return [`${where}: contextQuote deve ter ao menos 20 caracteres`];
  if (r.contextQuote.length + (typeof r.quote === 'string' ? r.quote.length : 0) + 7 > 500) return [`${where}: contextQuote + quote excedem 500 caracteres (limite do trecho da evidência)`];
  return [];
}
/** Trecho gravado na evidência: contexto […] citação (nunca mais que 500 caracteres; validado antes). */
const excerptOf = (q: { quote: string; contextQuote?: string }) => (q.contextQuote ? `${q.contextQuote} […] ${q.quote}` : q.quote);

const orgRef = (key: string) => `organization:${key}`;
const relRef = (r: SeedRelation) => `relation:${r.from}>${r.type}>${r.to}`;

function recordReason(ds: SeedDataset, ver: VerificationReport, ref: string, sourceId: string): string | null {
  const src = ds.sources.find((s) => s.id === sourceId)!;
  const vs = ver.sources.find((s) => s.id === sourceId);
  if (!vs) return 'fonte ausente no relatório de verificação';
  if (vs.url !== src.url) return 'URL da fonte diferente da verificada';
  if (vs.http_status !== 200 || !vs.fetched_at || !vs.content_sha256) return 'fonte não buscada com sucesso na verificação';
  if (Number.isNaN(Date.parse(vs.fetched_at))) return 'data de coleta inválida';
  const rec = ver.records.find((r) => r.ref === ref);
  if (!rec) return 'registro ausente no relatório de verificação';
  if (!rec.quote_found) return 'citação literal não encontrada na página da fonte';
  return null;
}

/** Dry-run (só leitura): diz o que seria criado, o que já existe e o que é recusado, e por quê. */
export async function planSeedLoad(db: Db, ds: SeedDataset, ver: VerificationReport | null): Promise<LoadPlan> {
  const issues = validateSeed(ds);
  if (!ver) issues.push('relatório de verificação ausente');
  else if (ver.datasetId !== ds.datasetId) issues.push('relatório de verificação é de outro conjunto');
  if (issues.length || !ver) return { datasetId: ds.datasetId, ok: false, issues, records: [], counts: { create: 0, exists: 0, rejected: 0 } };

  const records: RecordPlan[] = [];
  const orgByKey = new Map(ds.organizations.map((o) => [o.key, o]));
  for (const o of ds.organizations) {
    const ref = orgRef(o.key);
    const bad = recordReason(ds, ver, ref, o.sourceId);
    if (bad) { records.push({ ref, action: 'rejected', reason: bad }); continue; }
    const ex = await db.query(`SELECT 1 FROM intelligence.organization WHERE normalized_name = $1`, [normalizeOrgName(o.legalName)]);
    records.push({ ref, action: ex.rows[0] ? 'exists' : 'create' });
  }
  const rejectedOrg = new Set(records.filter((r) => r.action === 'rejected').map((r) => r.ref));
  for (const r of ds.relations) {
    const ref = relRef(r);
    const bad = recordReason(ds, ver, ref, r.sourceId);
    if (bad) { records.push({ ref, action: 'rejected', reason: bad }); continue; }
    if (rejectedOrg.has(orgRef(r.from)) || rejectedOrg.has(orgRef(r.to))) { records.push({ ref, action: 'rejected', reason: 'organização da relação foi recusada' }); continue; }
    const f = orgByKey.get(r.from)!, t = orgByKey.get(r.to)!;
    const ex = await db.query(
      `SELECT 1 FROM intelligence.org_relation x
         JOIN intelligence.organization a ON a.id = x.from_org_id AND a.normalized_name = $1
         JOIN intelligence.organization b ON b.id = x.to_org_id AND b.normalized_name = $2
        WHERE x.relation_type = $3 AND x.valid_to IS NULL AND x.certainty = 'declared'`,
      [normalizeOrgName(f.legalName), normalizeOrgName(t.legalName), r.type],
    );
    records.push({ ref, action: ex.rows[0] ? 'exists' : 'create' });
  }
  const c = (a: RecordPlan['action']) => records.filter((x) => x.action === a).length;
  return { datasetId: ds.datasetId, ok: true, issues: [], records, counts: { create: c('create'), exists: c('exists'), rejected: c('rejected') } };
}

/**
 * Carrega os registros APROVADOS (cria os novos; renova a validação dos existentes). Tudo em uma transação.
 * Registros recusados no plano não são carregados; o plano é devolvido junto para registro.
 */
export async function loadSeed(db: Db, ds: SeedDataset, ver: VerificationReport | null): Promise<{ plan: LoadPlan; manifest: LoadManifest | null }> {
  const plan = await planSeedLoad(db, ds, ver);
  if (!plan.ok || !ver) return { plan, manifest: null };
  const manifest: LoadManifest = { datasetId: ds.datasetId, loadedAt: new Date().toISOString(), evidenceIds: [], organizationsCreated: [], relationsCreated: [], relationsRevalidated: [] };
  const approved = new Set(plan.records.filter((r) => r.action !== 'rejected').map((r) => r.ref));
  const exists = new Set(plan.records.filter((r) => r.action === 'exists').map((r) => r.ref));
  const sourceById = new Map(ds.sources.map((s) => [s.id, s]));
  const verById = new Map(ver.sources.map((s) => [s.id, s]));

  const evidenceFor = async (sourceId: string, quote: string) => {
    const s = sourceById.get(sourceId)!, v = verById.get(sourceId)!;
    const id = await addEvidence(db, {
      sourceUrl: s.url, sourceName: s.name, retrievedAt: v.fetched_at!, contentHash: `sha256:${v.content_sha256}`, excerpt: quote, isMock: false,
    });
    manifest.evidenceIds.push(id);
    return { id, at: v.fetched_at! };
  };

  await db.query('BEGIN');
  try {
    const orgIds = new Map<string, Uuid>();
    for (const o of ds.organizations) {
      const ref = orgRef(o.key);
      if (!approved.has(ref)) continue;
      if (exists.has(ref)) {
        // já existe: não cria evidência nova nem altera a organização
        const cur = await db.query<{ id: Uuid }>(`SELECT id FROM intelligence.organization WHERE normalized_name = $1`, [normalizeOrgName(o.legalName)]);
        orgIds.set(o.key, cur.rows[0]!.id);
        continue;
      }
      const ev = await evidenceFor(o.sourceId, excerptOf(o));
      const id = await upsertOrganization(db, { legalName: o.legalName, tradeName: o.tradeName, kind: o.kind, evidenceId: ev.id, observedAt: ev.at });
      orgIds.set(o.key, id);
      manifest.organizationsCreated.push(id);
    }
    for (const r of ds.relations) {
      const ref = relRef(r);
      if (!approved.has(ref)) continue;
      const from = orgIds.get(r.from), to = orgIds.get(r.to);
      if (!from || !to) continue;
      const ev = await evidenceFor(r.sourceId, excerptOf(r));
      if (exists.has(ref)) {
        const upd = await db.query<{ id: Uuid }>(
          `UPDATE intelligence.org_relation SET validated_at = $4, evidence_id = $5
            WHERE from_org_id = $1 AND to_org_id = $2 AND relation_type = $3 AND valid_to IS NULL AND certainty = 'declared' RETURNING id`,
          [from, to, r.type, ev.at, ev.id],
        );
        manifest.relationsRevalidated.push(...upd.rows.map((x) => x.id));
      } else {
        manifest.relationsCreated.push(await addOrgRelation(db, {
          fromOrgId: from, toOrgId: to, type: r.type, validFrom: ev.at.slice(0, 10), certainty: 'declared', evidenceId: ev.id, observedAt: ev.at, validatedAt: ev.at,
        }));
      }
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  return { plan, manifest };
}

/** Desfaz uma carga pelo manifesto: relações e organizações CRIADAS por ela (se nada mais as referencia) e a evidência órfã. */
export async function rollbackSeed(db: Db, m: LoadManifest): Promise<{ relationsRemoved: number; organizationsRemoved: number; organizationsKept: number; evidenceRemoved: number }> {
  await db.query('BEGIN');
  try {
    const rel = m.relationsCreated.length ? await db.query(`DELETE FROM intelligence.org_relation WHERE id = ANY($1::uuid[]) RETURNING id`, [m.relationsCreated]) : { rows: [] };
    let removed = 0;
    for (const id of m.organizationsCreated) {
      const used = await db.query(
        `SELECT 1 WHERE EXISTS (SELECT 1 FROM intelligence.org_relation WHERE from_org_id = $1 OR to_org_id = $1)
                      OR EXISTS (SELECT 1 FROM intelligence.role_assignment WHERE organization_id = $1)
                      OR EXISTS (SELECT 1 FROM intelligence.org_chart_edge WHERE organization_id = $1)
                      OR EXISTS (SELECT 1 FROM intelligence.watchlist_item WHERE entity_type = 'organization' AND entity_id = $1)`,
        [id],
      );
      if (used.rows[0]) continue;
      removed += (await db.query(`DELETE FROM intelligence.organization WHERE id = $1 RETURNING id`, [id])).rows.length;
    }
    const ev = m.evidenceIds.length
      ? await db.query(
          `DELETE FROM intelligence.evidence e WHERE e.id = ANY($1::uuid[])
             AND NOT EXISTS (SELECT 1 FROM intelligence.organization WHERE evidence_id = e.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.org_relation WHERE evidence_id = e.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.role_assignment WHERE evidence_id = e.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.person WHERE evidence_id = e.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.move WHERE evidence_id = e.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.org_chart_edge WHERE evidence_id = e.id)
           RETURNING id`,
          [m.evidenceIds],
        )
      : { rows: [] };
    await db.query('COMMIT');
    return { relationsRemoved: rel.rows.length, organizationsRemoved: removed, organizationsKept: m.organizationsCreated.length - removed, evidenceRemoved: ev.rows.length };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
