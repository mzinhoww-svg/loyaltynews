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
import { addEvidence, addOrgRelation, addRole, resolveOrCreatePerson, revalidateRole, upsertOrganization } from './repo';
import { DEFAULT_CONFIG, PersonSuppressedError, type IntelligenceConfig } from './config';
import { SECONDARY_BASIS } from './moves';
import { normalizeName, normalizeOrgName, normalizeTitle } from './normalize';
import type { Uuid } from './types';

export const SEED_SCHEMA_VERSION = 'intelligence-seed/1';
/** v2 = v1 + `roles` (executivos e cargos públicos, só nome + cargo + empresa; só carrega com a flag de pessoas ligada). */
export const SEED_SCHEMA_VERSION_2 = 'intelligence-seed/2';
const SCHEMAS = [SEED_SCHEMA_VERSION, SEED_SCHEMA_VERSION_2] as const;
/** Fonte de nível "secundária" (cargo nunca vira fato sem confirmação oficial): redes profissionais e sites de organogramas. */
export const SECONDARY_HOSTS = /(^|\.)(linkedin\.com|theorg\.com)$/i;

const ORG_KINDS = ['company', 'program', 'association', 'regulator', 'media', 'other'] as const;
const REL_TYPES = ['parent_of', 'partner_of', 'supplier_of', 'coalition_member', 'acquired', 'other'] as const;

/**
 * method 'browser' | 'capture' = página que só renderiza com JavaScript ou que recusa leitura direta: texto capturado
 * (navegador do OpenBot ou provedor, DP-32) em data/captures/<id>.json (LOCAL, fora do git; no git só o <id>.meta.json).
 */
export interface SeedSource { id: string; name: string; url: string; method?: 'http' | 'browser' | 'capture' }
export const ROLE_LEVELS = ['oficial', 'secundaria'] as const;
export const ROLE_BODIES = ['diretoria', 'conselho'] as const;
/**
 * Cargo público de uma pessoa em uma organização (DP-11 P4: SÓ nome, cargo e empresa). Nenhum outro campo é aceito
 * (contato, foto, perfil, biografia...). `quote` precisa conter o nome e o cargo e estar literalmente na página.
 * sourceLevel 'oficial' = RI/"quem somos" da própria empresa => certeza declarada. 'secundaria' (LinkedIn/The Org, só página pública,
 * sem login) => status "a confirmar": entra como INFERIDA (nunca aparece no portal como fato) até haver leitura oficial.
 */
export interface SeedRole {
  personName: string;
  orgKey: string;
  title: string;
  /** 'conselho' = órgão de governança (exibido como "<cargo> (Conselho de Administração)"); padrão 'diretoria'. */
  body?: (typeof ROLE_BODIES)[number];
  sourceId: string;
  sourceLevel: (typeof ROLE_LEVELS)[number];
  quote: string;
  /** AAAA-MM-DD só se a PÁGINA declara a data de início/eleição; sem isso a vigência começa na data da verificação. */
  validFrom?: string;
}
export interface SeedOrganization { key: string; legalName: string; tradeName?: string; kind: (typeof ORG_KINDS)[number]; sourceId: string; quote: string; contextQuote?: string }
export interface SeedRelation { from: string; to: string; type: (typeof REL_TYPES)[number]; sourceId: string; quote: string; contextQuote?: string }
export interface SeedDataset {
  schemaVersion: (typeof SCHEMAS)[number];
  datasetId: string;
  description?: string;
  sources: SeedSource[];
  organizations: SeedOrganization[];
  relations: SeedRelation[];
  /** Só em intelligence-seed/2. */
  roles?: SeedRole[];
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
  /** Valores que as relações revalidadas tinham ANTES da carga (o desfazer os restaura). Ausente em manifestos antigos (v2: nenhuma relação revalidada). */
  relationsRevalidatedPrevious?: { id: Uuid; evidence_id: Uuid; validated_at: string }[];
  /** v2 (roles). Ausentes em manifestos antigos. */
  personsCreated?: Uuid[];
  rolesCreated?: Uuid[];
  rolesRevalidatedPrevious?: { id: Uuid; evidence_id: Uuid; validated_at: string; certainty?: string; inference_basis?: string | null }[];
  /** Cargos não carregados porque a pessoa foi suprimida a pedido do titular (nunca recriada). */
  rolesSkippedSuppressed?: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const HTTPS = /^https:\/\/\S+$/i;

/** Validação estrutural do conjunto (sem rede, sem banco). */
export function validateSeed(x: unknown): string[] {
  const out: string[] = [];
  if (!isObj(x)) return ['conjunto deve ser um objeto'];
  if (!SCHEMAS.includes(x.schemaVersion as never)) out.push(`schemaVersion deve ser ${SCHEMAS.join(' ou ')}`);
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
  if (Array.isArray(x.persons) && x.persons.length) out.push('persons: não suportado (cargos públicos entram por roles em intelligence-seed/2; mudanças pelo contrato role-observation/1)');
  if (x.roles !== undefined && x.schemaVersion !== SEED_SCHEMA_VERSION_2) out.push(`roles só existe em ${SEED_SCHEMA_VERSION_2}`);
  out.push(...roleIssues(x.roles, sources, keys));
  return out;
}

const ROLE_KEYS = ['personName', 'orgKey', 'title', 'body', 'sourceId', 'sourceLevel', 'quote', 'validFrom'];
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };
const squash = (q: string) => q.normalize('NFC').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

function roleIssues(roles: unknown, sources: unknown[], orgKeys: Set<string>): string[] {
  if (roles === undefined) return [];
  if (!Array.isArray(roles)) return ['roles deve ser uma lista'];
  const out: string[] = [];
  const srcById = new Map(sources.filter(isObj).map((s) => [String(s.id), s]));
  const seen = new Set<string>();
  roles.forEach((r, i) => {
    const w = `roles[${i}]`;
    if (!isObj(r)) return void out.push(`${w}: objeto esperado`);
    // DP-11 P4 / LGPD: só nome, cargo e empresa. Qualquer campo extra (e-mail, telefone, foto, perfil, biografia, opinião...) é recusado.
    for (const k of Object.keys(r)) if (!ROLE_KEYS.includes(k)) out.push(`${w}: campo ${k} não permitido (só nome, cargo, empresa e a evidência)`);
    const name = r.personName, title = r.title, quote = r.quote;
    if (typeof name !== 'string' || name.trim().length < 5 || name.length > 120 || /[\d@:/<>]/.test(name) || name.trim().split(/\s+/).length < 2) out.push(`${w}: personName deve ser um nome completo (sem dígitos, e-mail ou link)`);
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || /[@<>]|https?:/.test(title)) out.push(`${w}: title obrigatório (até 120 caracteres, sem e-mail ou link)`);
    if (typeof r.orgKey !== 'string' || !orgKeys.has(r.orgKey)) out.push(`${w}: orgKey desconhecida`);
    if (r.body !== undefined && !ROLE_BODIES.includes(r.body as never)) out.push(`${w}: body inválido`);
    const src = typeof r.sourceId === 'string' ? srcById.get(r.sourceId) : undefined;
    if (!src) out.push(`${w}: sourceId desconhecido`);
    if (!ROLE_LEVELS.includes(r.sourceLevel as never)) out.push(`${w}: sourceLevel deve ser oficial ou secundaria`);
    if (src && typeof src.url === 'string') {
      if (SECONDARY_HOSTS.test(hostOf(src.url)) && r.sourceLevel !== 'secundaria') out.push(`${w}: LinkedIn/The Org são fonte SECUNDÁRIA (status "a confirmar"), nunca oficial`);
      if (/linkedin\.com\/(login|uas|checkpoint|authwall)/i.test(src.url)) out.push(`${w}: página de login não é fonte`);
    }
    if (typeof quote !== 'string' || quote.length < 20 || quote.length > 300) out.push(`${w}: quote deve ter 20 a 300 caracteres`);
    else {
      if (typeof name === 'string' && !squash(quote).includes(squash(name))) out.push(`${w}: a citação não contém o nome`);
      if (typeof title === 'string' && !squash(quote).includes(squash(title))) out.push(`${w}: a citação não contém o cargo`);
    }
    if (r.validFrom !== undefined && !(typeof r.validFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.validFrom) && !Number.isNaN(Date.parse(r.validFrom)))) out.push(`${w}: validFrom deve ser AAAA-MM-DD`);
    if (typeof name === 'string' && typeof title === 'string' && typeof r.orgKey === 'string') {
      const id = roleRef({ orgKey: r.orgKey, personName: name, title });
      if (seen.has(id)) out.push(`${w}: cargo repetido`); else seen.add(id);
    }
  });
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
/** Referência do cargo no relatório de verificação (o verificador monta a mesma string). */
export const roleRef = (r: Pick<SeedRole, 'orgKey' | 'personName' | 'title'>) => `role:${r.orgKey}>${r.personName}>${r.title}`;
/** Cargo como é gravado no cadastro (cargo do conselho leva o órgão). */
export const roleTitle = (r: SeedRole) => (r.body === 'conselho' ? `${r.title} (Conselho de Administração)` : r.title);
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
export async function planSeedLoad(db: Db, ds: SeedDataset, ver: VerificationReport | null, cfg: IntelligenceConfig = DEFAULT_CONFIG): Promise<LoadPlan> {
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
  for (const r of ds.roles ?? []) {
    const ref = roleRef(r);
    const bad = recordReason(ds, ver, ref, r.sourceId);
    if (bad) { records.push({ ref, action: 'rejected', reason: bad }); continue; }
    // Pessoas só entram com a flag ligada (J-01 em aberto): sem ela o plano recusa TODOS os cargos, com o motivo.
    if (!cfg.personIngestion) { records.push({ ref, action: 'rejected', reason: 'ingestão de pessoas desligada (flag intelligencePessoas; J-01): só com decisão registrada e --with-persons' }); continue; }
    if (rejectedOrg.has(orgRef(r.orgKey))) { records.push({ ref, action: 'rejected', reason: 'organização do cargo foi recusada' }); continue; }
    const o = orgByKey.get(r.orgKey)!;
    const cur = await db.query<{ normalized_title: string; suppressed: boolean }>(
      `SELECT ra.normalized_title, (p.suppressed_at IS NOT NULL) AS suppressed
         FROM intelligence.person p
         JOIN intelligence.role_assignment ra ON ra.person_id = p.id AND ra.valid_to IS NULL
         JOIN intelligence.organization org ON org.id = ra.organization_id AND org.normalized_name = $2
        WHERE p.normalized_name = $1`,
      [normalizeName(r.personName), normalizeOrgName(o.legalName)],
    );
    if (cur.rows.some((x) => x.suppressed)) { records.push({ ref, action: 'rejected', reason: 'pessoa suprimida a pedido do titular (não é recriada)' }); continue; }
    if (cur.rows.some((x) => x.normalized_title === normalizeTitle(roleTitle(r)))) { records.push({ ref, action: 'exists' }); continue; }
    if (cur.rows.length) { records.push({ ref, action: 'rejected', reason: 'a pessoa já tem outro cargo em aberto nesta organização: mudança de cargo é tratada pelo contrato role-observation/1 (gera Move com evidência de antes e depois)' }); continue; }
    records.push({ ref, action: 'create' });
  }
  const c = (a: RecordPlan['action']) => records.filter((x) => x.action === a).length;
  return { datasetId: ds.datasetId, ok: true, issues: [], records, counts: { create: c('create'), exists: c('exists'), rejected: c('rejected') } };
}

/**
 * Carrega os registros APROVADOS (cria os novos; renova a validação dos existentes). Tudo em uma transação.
 * Registros recusados no plano não são carregados; o plano é devolvido junto para registro.
 */
export async function loadSeed(db: Db, ds: SeedDataset, ver: VerificationReport | null, cfg: IntelligenceConfig = DEFAULT_CONFIG): Promise<{ plan: LoadPlan; manifest: LoadManifest | null }> {
  const plan = await planSeedLoad(db, ds, ver, cfg);
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
        // guarda os valores ANTERIORES de evidência e validação: o desfazer os restaura (nada de "só as contagens voltam")
        const prev = await db.query<{ id: Uuid; evidence_id: Uuid; validated_at: string | Date }>(
          `SELECT id, evidence_id, validated_at FROM intelligence.org_relation
            WHERE from_org_id = $1 AND to_org_id = $2 AND relation_type = $3 AND valid_to IS NULL AND certainty = 'declared'`,
          [from, to, r.type],
        );
        const upd = await db.query<{ id: Uuid }>(
          `UPDATE intelligence.org_relation SET validated_at = $4, evidence_id = $5
            WHERE from_org_id = $1 AND to_org_id = $2 AND relation_type = $3 AND valid_to IS NULL AND certainty = 'declared' RETURNING id`,
          [from, to, r.type, ev.at, ev.id],
        );
        manifest.relationsRevalidated.push(...upd.rows.map((x) => x.id));
        (manifest.relationsRevalidatedPrevious ??= []).push(...prev.rows.map((x) => ({ id: x.id, evidence_id: x.evidence_id, validated_at: new Date(x.validated_at).toISOString() })));
      } else {
        manifest.relationsCreated.push(await addOrgRelation(db, {
          fromOrgId: from, toOrgId: to, type: r.type, validFrom: ev.at.slice(0, 10), certainty: 'declared', evidenceId: ev.id, observedAt: ev.at, validatedAt: ev.at,
        }));
      }
    }
    for (const r of ds.roles ?? []) {
      const ref = roleRef(r);
      if (!approved.has(ref)) continue;
      const orgId = orgIds.get(r.orgKey);
      if (!orgId) continue;
      const ev = await evidenceFor(r.sourceId, r.quote);
      const official = r.sourceLevel === 'oficial';
      const title = roleTitle(r);
      let person: { id: Uuid; created: boolean };
      try {
        person = await resolveOrCreatePerson(db, { fullName: r.personName, organizationId: orgId, evidenceId: ev.id, observedAt: ev.at }, cfg);
      } catch (e) {
        if (e instanceof PersonSuppressedError) { manifest.rolesSkippedSuppressed = (manifest.rolesSkippedSuppressed ?? 0) + 1; continue; }
        throw e;
      }
      if (person.created) (manifest.personsCreated ??= []).push(person.id);
      if (exists.has(ref)) {
        const cur = await db.query<{ id: Uuid; evidence_id: Uuid; validated_at: string | Date; certainty: string; inference_basis: string | null }>(
          `SELECT id, evidence_id, validated_at, certainty, inference_basis FROM intelligence.role_assignment
            WHERE person_id = $1 AND organization_id = $2 AND normalized_title = $3 AND valid_to IS NULL`,
          [person.id, orgId, normalizeTitle(title)],
        );
        for (const x of cur.rows) {
          (manifest.rolesRevalidatedPrevious ??= []).push({ id: x.id, evidence_id: x.evidence_id, validated_at: new Date(x.validated_at).toISOString(), certainty: x.certainty, inference_basis: x.inference_basis });
          await revalidateRole(db, x.id, ev.at, ev.id);
          // leitura oficial confirma o que estava "a confirmar" (nunca o contrário: secundária não rebaixa o oficial)
          if (official && x.certainty === 'inferred') await db.query(`UPDATE intelligence.role_assignment SET certainty = 'declared', inference_basis = NULL WHERE id = $1`, [x.id]);
        }
      } else {
        (manifest.rolesCreated ??= []).push(await addRole(db, {
          personId: person.id, organizationId: orgId, title, validFrom: r.validFrom ?? ev.at.slice(0, 10),
          certainty: official ? 'declared' : 'inferred', inferenceBasis: official ? undefined : SECONDARY_BASIS,
          evidenceId: ev.id, observedAt: ev.at, validatedAt: ev.at,
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
export async function rollbackSeed(db: Db, m: LoadManifest): Promise<{ relationsRemoved: number; organizationsRemoved: number; organizationsKept: number; evidenceRemoved: number; rolesRemoved: number; personsRemoved: number }> {
  await db.query('BEGIN');
  try {
    // cargos: restaura os revalidados (evidência, data e certeza anteriores), apaga os criados e as pessoas criadas que ficaram sem cargo/Move
    for (const p of m.rolesRevalidatedPrevious ?? []) {
      await db.query(
        `UPDATE intelligence.role_assignment SET evidence_id = $2::uuid, validated_at = $3::timestamptz,
                certainty = COALESCE($4, certainty), inference_basis = CASE WHEN $4 IS NULL THEN inference_basis ELSE $5 END WHERE id = $1::uuid`,
        [p.id, p.evidence_id, p.validated_at, p.certainty ?? null, p.inference_basis ?? null],
      );
    }
    const rolesDel = m.rolesCreated?.length ? await db.query(`DELETE FROM intelligence.role_assignment WHERE id = ANY($1::uuid[]) RETURNING id`, [m.rolesCreated]) : { rows: [] };
    const personsDel = m.personsCreated?.length
      ? await db.query(
          `DELETE FROM intelligence.person p WHERE p.id = ANY($1::uuid[])
             AND NOT EXISTS (SELECT 1 FROM intelligence.role_assignment WHERE person_id = p.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.move WHERE person_id = p.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.data_subject_request WHERE person_id = p.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.person_extended WHERE person_id = p.id)
             AND NOT EXISTS (SELECT 1 FROM intelligence.watchlist_item WHERE entity_type = 'person' AND entity_id = p.id)
           RETURNING id`,
          [m.personsCreated],
        )
      : { rows: [] };
    const rel = m.relationsCreated.length ? await db.query(`DELETE FROM intelligence.org_relation WHERE id = ANY($1::uuid[]) RETURNING id`, [m.relationsCreated]) : { rows: [] };
    // restaura evidência e data de validação que a carga trocou nas relações já existentes (antes de apagar a evidência nova)
    for (const p of m.relationsRevalidatedPrevious ?? []) {
      await db.query(`UPDATE intelligence.org_relation SET evidence_id = $2::uuid, validated_at = $3::timestamptz WHERE id = $1::uuid`, [p.id, p.evidence_id, p.validated_at]);
    }
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
    return { relationsRemoved: rel.rows.length, organizationsRemoved: removed, organizationsKept: m.organizationsCreated.length - removed, evidenceRemoved: ev.rows.length, rolesRemoved: rolesDel.rows.length, personsRemoved: personsDel.rows.length };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
