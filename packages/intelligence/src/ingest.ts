/**
 * Contrato de ingestão Editorial -> Intelligence (versão `role-observation/1`).
 * O Editorial (packages/editorial) entrega lotes `RoleObservationBatch`; o Intelligence valida, grava evidência e
 * processa cada observação (processObservation). Documento: docs/ingestion-contract.md.
 *
 * Garantias:
 *  - Validação estrita: chave desconhecida é recusada; só fonte pública http(s); trecho ≤ 500 caracteres.
 *  - Isolamento: item inválido é reportado e não bloqueia os demais do lote.
 *  - Idempotência: reenviar o mesmo lote não cria Move nem cargo duplicados.
 *  - Dado pessoal: só nome, cargo e empresa (DP-11 P4). `extra` é recusado com a flag desligada.
 */
import type { Db } from './db';
import { DEFAULT_CONFIG, ExtendedPersonalDataDisabledError, type IntelligenceConfig } from './config';
import { processObservation, type ObservationResult } from './moves';
import { addEvidence } from './repo';
import type { RoleObservation, Uuid } from './types';

export const INGEST_SCHEMA_VERSION = 'role-observation/1';

/** O que o Editorial envia (sem `evidenceId`: ele é atribuído pelo Intelligence a partir de `evidence`). */
export interface RoleObservationInput {
  personName: string;
  publicProfileUrl?: string;
  orgName: string;
  title: string;
  kind: 'present' | 'left';
  /** ISO 8601 com horário; instante em que a fonte mostrou o fato. */
  observedAt: string;
  /** Só se a própria fonte anuncia a mudança. */
  announcement?: { effectiveDate?: string };
  /** Reservado; recusado enquanto a flag de dado ampliado estiver desligada. */
  extra?: Record<string, unknown>;
}

export interface RoleObservationBatch {
  schemaVersion: typeof INGEST_SCHEMA_VERSION;
  evidence: {
    sourceUrl: string;
    sourceName: string;
    retrievedAt: string;
    contentHash?: string;
    excerpt?: string;
    isMock?: boolean;
  };
  observations: RoleObservationInput[];
}

export interface ValidationIssue { path: string; message: string }

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URLRE = /^https?:\/\/[^\s]+$/i;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function unknownKeys(o: Record<string, unknown>, allowed: string[], path: string, out: ValidationIssue[]) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) out.push({ path: `${path}${k}`, message: 'campo desconhecido' });
}
function str(o: Record<string, unknown>, k: string, path: string, out: ValidationIssue[], max: number, required = true) {
  const v = o[k];
  if (v === undefined || v === null) { if (required) out.push({ path: `${path}${k}`, message: 'obrigatório' }); return; }
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) out.push({ path: `${path}${k}`, message: `texto não vazio de até ${max} caracteres` });
}
const validIso = (v: unknown) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));

export function validateObservation(x: unknown, path = ''): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!isObj(x)) return [{ path: path || '$', message: 'objeto esperado' }];
  unknownKeys(x, ['personName', 'publicProfileUrl', 'orgName', 'title', 'kind', 'observedAt', 'announcement', 'extra'], path, out);
  str(x, 'personName', path, out, 200);
  str(x, 'orgName', path, out, 200);
  str(x, 'title', path, out, 200);
  if (x.kind !== 'present' && x.kind !== 'left') out.push({ path: `${path}kind`, message: "deve ser 'present' ou 'left'" });
  if (!validIso(x.observedAt)) out.push({ path: `${path}observedAt`, message: 'ISO 8601 com fuso, ex.: 2026-11-22T10:00:00Z' });
  if (x.publicProfileUrl !== undefined && (typeof x.publicProfileUrl !== 'string' || !URLRE.test(x.publicProfileUrl))) {
    out.push({ path: `${path}publicProfileUrl`, message: 'URL http(s) pública' });
  }
  if (x.announcement !== undefined) {
    if (!isObj(x.announcement)) out.push({ path: `${path}announcement`, message: 'objeto esperado' });
    else {
      unknownKeys(x.announcement, ['effectiveDate'], `${path}announcement.`, out);
      const d = x.announcement.effectiveDate;
      if (d !== undefined && !(typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(d)))) {
        out.push({ path: `${path}announcement.effectiveDate`, message: 'AAAA-MM-DD' });
      }
    }
  }
  if (x.extra !== undefined && !isObj(x.extra)) out.push({ path: `${path}extra`, message: 'objeto esperado' });
  return out;
}

export function validateBatch(x: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!isObj(x)) return [{ path: '$', message: 'objeto esperado' }];
  unknownKeys(x, ['schemaVersion', 'evidence', 'observations'], '', out);
  if (x.schemaVersion !== INGEST_SCHEMA_VERSION) out.push({ path: 'schemaVersion', message: `deve ser ${INGEST_SCHEMA_VERSION}` });
  const ev = x.evidence;
  if (!isObj(ev)) out.push({ path: 'evidence', message: 'objeto esperado' });
  else {
    unknownKeys(ev, ['sourceUrl', 'sourceName', 'retrievedAt', 'contentHash', 'excerpt', 'isMock'], 'evidence.', out);
    if (typeof ev.sourceUrl !== 'string' || !URLRE.test(ev.sourceUrl)) out.push({ path: 'evidence.sourceUrl', message: 'URL http(s) de fonte pública' });
    str(ev, 'sourceName', 'evidence.', out, 200);
    if (!validIso(ev.retrievedAt)) out.push({ path: 'evidence.retrievedAt', message: 'ISO 8601 com fuso' });
    if (ev.excerpt !== undefined && (typeof ev.excerpt !== 'string' || ev.excerpt.length > 500)) out.push({ path: 'evidence.excerpt', message: 'até 500 caracteres' });
    if (ev.contentHash !== undefined && (typeof ev.contentHash !== 'string' || ev.contentHash.length > 128)) out.push({ path: 'evidence.contentHash', message: 'até 128 caracteres' });
    if (ev.isMock !== undefined && typeof ev.isMock !== 'boolean') out.push({ path: 'evidence.isMock', message: 'booleano' });
  }
  if (!Array.isArray(x.observations) || x.observations.length === 0 || x.observations.length > 500) {
    out.push({ path: 'observations', message: 'lista de 1 a 500 observações' });
  }
  return out;
}

export type ItemResult =
  | { index: number; status: 'processed'; result: ObservationResult }
  | { index: number; status: 'rejected'; code: 'invalid' | 'extended_personal_data_disabled' | 'error'; issues: ValidationIssue[] };

export interface IngestReport {
  schemaVersion: typeof INGEST_SCHEMA_VERSION;
  evidenceId: Uuid | null;
  accepted: boolean; // false = lote inteiro recusado (cabeçalho inválido)
  batchIssues: ValidationIssue[];
  items: ItemResult[];
  counts: { processed: number; rejected: number; moves: number };
}

/** Ingere um lote. Nunca lança por dado inválido; reporta por item. Erro de infraestrutura (banco) continua lançando. */
export async function ingestBatch(db: Db, batch: unknown, cfg: IntelligenceConfig = DEFAULT_CONFIG): Promise<IngestReport> {
  const batchIssues = validateBatch(batch);
  const empty = (): IngestReport => ({
    schemaVersion: INGEST_SCHEMA_VERSION, evidenceId: null, accepted: false, batchIssues, items: [], counts: { processed: 0, rejected: 0, moves: 0 },
  });
  if (!cfg.personIngestion) {
    // Flag `intelligencePessoas` desligada (J-01): nenhuma pessoa entra; recusa antes de gravar qualquer evidência.
    batchIssues.push({ path: '$', message: 'person_ingestion_disabled: flag intelligencePessoas desligada (J-01)' });
  }
  if (batchIssues.length) return empty();
  const b = batch as RoleObservationBatch;

  const evidenceId = await addEvidence(db, { ...b.evidence });
  const items: ItemResult[] = [];
  let moves = 0;
  for (const [index, raw] of b.observations.entries()) {
    const issues = validateObservation(raw, `observations[${index}].`);
    if (issues.length) { items.push({ index, status: 'rejected', code: 'invalid', issues }); continue; }
    const o = raw as RoleObservationInput;
    const obs: RoleObservation = { ...o, evidenceId };
    try {
      const result = await processObservation(db, obs, cfg);
      if (result.outcome === 'move') moves++;
      items.push({ index, status: 'processed', result });
    } catch (e) {
      if (e instanceof ExtendedPersonalDataDisabledError) {
        items.push({ index, status: 'rejected', code: 'extended_personal_data_disabled', issues: e.fields.map((f) => ({ path: `observations[${index}].extra.${f}`, message: 'dado pessoal ampliado desligado' })) });
      } else if (isDataError(e)) {
        items.push({ index, status: 'rejected', code: 'error', issues: [{ path: `observations[${index}]`, message: String((e as Error).message).slice(0, 200) }] });
      } else throw e;
    }
  }
  const processed = items.filter((i) => i.status === 'processed').length;
  return { schemaVersion: INGEST_SCHEMA_VERSION, evidenceId, accepted: true, batchIssues: [], items, counts: { processed, rejected: items.length - processed, moves } };
}

/** Violação de restrição de dados (check/unique/not null): item recusado; falha de conexão não entra aqui. */
function isDataError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return typeof code === 'string' && /^(22|23)/.test(code);
}

/** JSON Schema (draft 2020-12) do lote, para o Editorial validar antes de enviar. Espelha validateBatch. */
export const ROLE_OBSERVATION_BATCH_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://loyaltynews.invalid/schemas/role-observation-batch-1.json',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'evidence', 'observations'],
  properties: {
    schemaVersion: { const: INGEST_SCHEMA_VERSION },
    evidence: {
      type: 'object', additionalProperties: false, required: ['sourceUrl', 'sourceName', 'retrievedAt'],
      properties: {
        sourceUrl: { type: 'string', pattern: '^https?://\\S+$' }, sourceName: { type: 'string', minLength: 1, maxLength: 200 },
        retrievedAt: { type: 'string', format: 'date-time' }, contentHash: { type: 'string', maxLength: 128 },
        excerpt: { type: 'string', maxLength: 500 }, isMock: { type: 'boolean' },
      },
    },
    observations: {
      type: 'array', minItems: 1, maxItems: 500,
      items: {
        type: 'object', additionalProperties: false, required: ['personName', 'orgName', 'title', 'kind', 'observedAt'],
        properties: {
          personName: { type: 'string', minLength: 1, maxLength: 200 }, publicProfileUrl: { type: 'string', pattern: '^https?://\\S+$' },
          orgName: { type: 'string', minLength: 1, maxLength: 200 }, title: { type: 'string', minLength: 1, maxLength: 200 },
          kind: { enum: ['present', 'left'] }, observedAt: { type: 'string', format: 'date-time' },
          announcement: { type: 'object', additionalProperties: false, properties: { effectiveDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } },
          extra: { type: 'object' },
        },
      },
    },
  },
} as const;
