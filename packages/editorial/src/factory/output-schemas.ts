import { z } from 'zod';
import { EDITORIAS } from '../types';
import type { TaskClass } from '../gateway';
import { RESUMO_MAX } from '../publishable';

/**
 * Esquema de saída de CADA classe de tarefa (o formato que o prompt pede e o estágio lê). Serve para medir `output_valid` (meta ≥ 95%):
 * a resposta do modelo veio no formato? Não mede qualidade nem veracidade (isso são os gates e a rubrica de leitura). Chaves a mais
 * são toleradas (`strict: false`, padrão); `strict: true` as recusa. Referências cruzadas (ids de evidência e de claim) só são
 * conferidas quando o chamador as informa.
 */
const str = z.string().min(1);
const claim = z.object({
  id: str, text: str, kind: z.enum(['fact', 'number', 'quote', 'date']), evidenceIds: z.array(str).min(1),
  quote: z.object({ text: str, speaker: str }).optional(),
}).refine((c) => c.kind !== 'quote' || !!c.quote, { message: 'claim "quote" exige quote {text, speaker}', path: ['quote'] });

const SCHEMAS: Record<TaskClass, z.ZodObject<z.ZodRawShape>> = {
  triage: z.object({ relevant: z.boolean(), editoria: z.enum(EDITORIAS as unknown as [string, ...string[]]).optional() }),
  context: z.object({ notes: z.array(z.object({ text: str, evidenceIds: z.array(str).min(1) })) }),
  draft: z.object({
    headline: str.max(200), body: str, resumo: str.max(RESUMO_MAX), subtitulo: z.string().max(RESUMO_MAX).optional(),
    claims: z.array(claim).min(1),
    imageCandidate: z.object({ url: str, credit: z.string().optional(), creditLink: z.string().optional(), alt: z.string().optional() }).optional(),
  }),
  factcheck: z.object({ verdicts: z.array(z.object({ claimId: str, verdict: z.enum(['pass', 'fail', 'inconclusive']) })).min(1) }),
  review: z.object({ approve: z.boolean(), issues: z.array(z.string()).optional() }),
  social_pack: z.object({ linkedin: str.max(1200), instagram: z.string().optional() }),
  roles: z.object({ mentions: z.array(z.object({
    personName: str, orgName: str, title: str, kind: z.enum(['present', 'left']), announced: z.boolean().optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), excerpt: str.max(500),
  })) }),
};

export interface OutputCheck { valid: boolean; issues: string[] }
export interface OutputContext { /** ids de evidência recebidos na entrada (claims/notas só podem citar estes) */ evidenceIds?: readonly string[]; /** ids de claim a cobrir (checagem) */ claimIds?: readonly string[]; strict?: boolean }

/** Valida a saída (objeto JSON já extraído) de uma classe de tarefa. */
export function validateModelOutput(taskClass: TaskClass, output: unknown, ctx: OutputContext = {}): OutputCheck {
  const schema = ctx.strict ? SCHEMAS[taskClass].strict() : SCHEMAS[taskClass];
  const r = schema.safeParse(output);
  const issues = r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`);
  if (r.success) {
    const o = r.data as Record<string, unknown>;
    const ev = ctx.evidenceIds ? new Set(ctx.evidenceIds) : null;
    if (ev) {
      const refs: string[] = [];
      for (const n of (o['notes'] as Array<{ evidenceIds: string[] }> | undefined) ?? []) refs.push(...n.evidenceIds);
      for (const c of (o['claims'] as Array<{ evidenceIds: string[] }> | undefined) ?? []) refs.push(...c.evidenceIds);
      for (const id of refs) if (!ev.has(id)) issues.push(`evidência inexistente na entrada: ${id}`);
    }
    if (ctx.claimIds && taskClass === 'factcheck') {
      const got = new Set(((o['verdicts'] as Array<{ claimId: string }>) ?? []).map((v) => v.claimId));
      for (const id of ctx.claimIds) if (!got.has(id)) issues.push(`claim sem veredito: ${id}`);
    }
  }
  return { valid: issues.length === 0, issues };
}

/** JSON Schema de cada classe (zod 4), para o avaliador do piloto e para documentação. */
export function outputJsonSchemas(): Record<TaskClass, unknown> {
  return Object.fromEntries((Object.keys(SCHEMAS) as TaskClass[]).map((k) => [k, z.toJSONSchema(SCHEMAS[k], { unrepresentable: 'any' })])) as Record<TaskClass, unknown>;
}
