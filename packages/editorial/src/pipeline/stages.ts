import type { Claim, Draft, Evidence, Finding } from '../types';
import { EDITORIAS, SIGNATURE } from '../types';
import type { EditorialFlags } from '../flags';
import { requireFlag } from '../flags';
import type { GatewayRequest, GatewayResponse, ModelGateway, RouteClass, TaskClass, WorkflowId } from '../gateway';
import type { SourceRegistry } from '../sources/registry';
import { eligibility } from '../sources/registry';
import {
  buildAttribution, decideImage, digitsKey, fabricatedReportingFindings, mainBody, numbersIn, runDeterministicChecks,
} from '../rules/rules';
import { normalizeText } from '../dedupe/dedupe';
import type { ArticleJob, BlockerCode, FactVerdict, JobSpec, SocialPack, StageOutcome } from './jobs';

export const MAX_ATTEMPTS = 3; // model.policy.json rules.max_attempts

/** Registro interno (Blueprint §6): modelo, evidências, versões. Em produção persiste no PostgreSQL. */
export interface AuditEntry {
  at: string; articleId: string; stage: string; event: string;
  provider?: string; model?: string; promptVersion?: string; evidenceIds?: string[]; detail?: string;
}
export interface AuditLog { record(e: AuditEntry): void }
export class InMemoryAuditLog implements AuditLog {
  entries: AuditEntry[] = [];
  record(e: AuditEntry): void { this.entries.push(e); }
}

export interface StageDeps {
  gateway: ModelGateway;
  registry: SourceRegistry;
  audit: AuditLog;
  flags?: Partial<EditorialFlags>;
  now?: () => Date;
  siteBaseUrl?: string;
}

const PROMPT_VERSION = 'editorial-0.1';

function blocked(job: ArticleJob, stage: JobSpec['stage'], blockers: BlockerCode[], findings: Finding[] = []): StageOutcome {
  return { kind: 'blocked', blocked: { articleId: job.articleId, stage, blockers, findings } };
}
const next = (stage: JobSpec['stage'], data: ArticleJob): StageOutcome => ({ kind: 'next', next: { stage, jobId: `${data.articleId}:${stage}:${data.attempt}`, data } });

async function call(deps: StageDeps, job: ArticleJob, stage: JobSpec['stage'], taskClass: TaskClass, route: RouteClass, workflow: WorkflowId,
  input: unknown, excludeProviders: string[] = []): Promise<GatewayResponse> {
  const req: GatewayRequest = {
    taskClass, route, workflow, dataClass: 'public', excludeProviders, input, promptVersion: PROMPT_VERSION,
    idempotencyKey: `${job.articleId}:${taskClass}:${job.attempt}`,
  };
  const r = await deps.gateway.invoke(req);
  deps.audit.record({
    at: (deps.now?.() ?? new Date()).toISOString(), articleId: job.articleId, stage, event: r.ok ? 'model_call' : `refused:${r.refusal}`,
    ...(r.ok ? { provider: r.provider, model: r.model } : {}), promptVersion: PROMPT_VERSION,
    evidenceIds: job.evidences.map((e) => e.id), ...(r.ok ? {} : r.detail ? { detail: r.detail } : {}),
  });
  return r;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const bad = (job: ArticleJob, stage: JobSpec['stage'], msg: string): StageOutcome =>
  blocked(job, stage, ['invalid_model_output'], [{ code: 'invalid_model_output', message: msg }]);
const refused = (job: ArticleJob, stage: JobSpec['stage'], r: Extract<GatewayResponse, { ok: false }>): StageOutcome =>
  blocked(job, stage, [r.refusal === 'no_independent_provider' ? 'cross_provider_check_failed' : 'budget_blocked'],
    [{ code: r.refusal, message: r.detail ?? r.refusal }]);

/** Evidência é dado não confiável: vai ao modelo só como string citada, nunca como instrução. */
const untrusted = (evs: Evidence[]) => evs.map((e) => ({ id: e.id, sourceId: e.sourceId, title: e.title, text: e.text.slice(0, 6000), suspicious: e.suspicious }));

// ---------------- 1. triagem (WF01) ----------------
export async function triage(deps: StageDeps, job: ArticleJob): Promise<StageOutcome> {
  requireFlag(deps.flags, 'editorial.pipeline.enabled');
  if (job.duplicateOf) return blocked(job, 'triage', ['duplicate'], [{ code: 'duplicate', message: `duplicata de ${job.duplicateOf}` }]);
  if (!job.evidences.length) return blocked(job, 'triage', ['rights_unknown'], [{ code: 'no_evidence', message: 'sem evidência coletada' }]);
  const findings: Finding[] = [];
  for (const e of job.evidences) {
    const s = deps.registry.get(e.sourceId);
    const el = s ? eligibility(s) : null;
    if (!s || !el || !el.ok) findings.push({ code: 'rights_unknown', message: `fonte ${e.sourceId} sem termos aprovados/elegibilidade` });
    if (e.suspicious) findings.push({ code: 'suspicious_evidence', message: `evidência ${e.id}: ${e.suspiciousReasons.join(',')}` });
  }
  if (findings.length) {
    return blocked(job, 'triage', [...(findings.some((x) => x.code === 'rights_unknown') ? ['rights_unknown' as const] : []),
      ...(findings.some((x) => x.code === 'suspicious_evidence') ? ['suspicious_evidence' as const] : [])], findings);
  }
  const r = await call(deps, job, 'triage', 'triage', 'economy', 'WF01', { editorias: EDITORIAS, evidences: untrusted(job.evidences) });
  if (!r.ok) return refused(job, 'triage', r);
  if (!isObj(r.output) || typeof r.output['relevant'] !== 'boolean') return bad(job, 'triage', 'triage: esperado {relevant:boolean}');
  if (!r.output['relevant']) return blocked(job, 'triage', ['not_relevant'], [{ code: 'not_relevant', message: 'triagem descartou a pauta' }]);
  const ed = r.output['editoria'];
  const editoria = typeof ed === 'string' && (EDITORIAS as readonly string[]).includes(ed) ? (ed as typeof job.editoria) : job.editoria;
  return next('context', { ...job, editoria });
}

// ---------------- 2. contexto ----------------
export async function context(deps: StageDeps, job: ArticleJob): Promise<StageOutcome> {
  requireFlag(deps.flags, 'editorial.pipeline.enabled');
  const r = await call(deps, job, 'context', 'context', 'economy', 'WF02', { editoria: job.editoria, evidences: untrusted(job.evidences) });
  if (!r.ok) return refused(job, 'context', r);
  if (!isObj(r.output) || !Array.isArray(r.output['notes'])) return bad(job, 'context', 'context: esperado {notes:[]}');
  const ids = new Set(job.evidences.map((e) => e.id));
  const notes = [];
  for (const n of r.output['notes']) {
    if (!isObj(n) || typeof n['text'] !== 'string' || !Array.isArray(n['evidenceIds']) || !n['evidenceIds'].length ||
      !n['evidenceIds'].every((i) => typeof i === 'string' && ids.has(i))) return bad(job, 'context', 'context: nota sem evidência válida (contexto não é fonte)');
    notes.push({ text: n['text'], evidenceIds: n['evidenceIds'] as string[] });
  }
  return next('draft', { ...job, context: notes });
}

// ---------------- 3. redação (WF02) ----------------
function parseClaims(x: unknown): Claim[] | null {
  if (!Array.isArray(x)) return null;
  const out: Claim[] = [];
  for (const c of x) {
    if (!isObj(c) || typeof c['id'] !== 'string' || typeof c['text'] !== 'string' || !Array.isArray(c['evidenceIds'])) return null;
    const kind = c['kind'];
    if (kind !== 'fact' && kind !== 'number' && kind !== 'quote' && kind !== 'date') return null;
    const claim: Claim = { id: c['id'], text: c['text'], kind, evidenceIds: (c['evidenceIds'] as unknown[]).filter((i): i is string => typeof i === 'string') };
    const q = c['quote'];
    if (isObj(q) && typeof q['text'] === 'string' && typeof q['speaker'] === 'string') claim.quote = { text: q['text'], speaker: q['speaker'] };
    out.push(claim);
  }
  return out;
}

const FINDING_TO_BLOCKER: Record<string, BlockerCode> = {
  copy_literal: 'copy_literal', rights_basis_unresolved: 'rights_basis_unresolved', suspicious_evidence: 'suspicious_evidence',
};
const toBlockers = (fs: Finding[]): BlockerCode[] => [...new Set(fs.map((x) => FINDING_TO_BLOCKER[x.code] ?? 'unsupported_claim'))];

export async function draft(deps: StageDeps, job: ArticleJob): Promise<StageOutcome> {
  requireFlag(deps.flags, 'editorial.pipeline.enabled');
  const r = await call(deps, job, 'draft', 'draft', 'review', 'WF02', {
    editoria: job.editoria, evidences: untrusted(job.evidences), context: job.context ?? [], feedback: job.feedback ?? [],
    rules: ['usar somente fatos das evidências', 'não inventar falas, fontes, entrevistas ou métricas', 'não copiar trechos da fonte', `não assinar com nome de pessoa; assinatura é ${SIGNATURE}`],
  });
  if (!r.ok) return refused(job, 'draft', r);
  const o = r.output;
  const claims = isObj(o) ? parseClaims(o['claims']) : null;
  if (!isObj(o) || typeof o['headline'] !== 'string' || typeof o['body'] !== 'string' || !claims) {
    return bad(job, 'draft', 'draft: esperado {headline, body, claims[]}');
  }
  const evidenceIds = [...new Set(claims.flatMap((c) => c.evidenceIds))];
  const used = job.evidences.filter((e) => evidenceIds.includes(e.id));
  const sources = deps.registry.all();
  const primary = used[0] ? deps.registry.get(used[0].sourceId) : undefined;
  const cand = isObj(o['imageCandidate']) && typeof o['imageCandidate']['url'] === 'string'
    ? { url: o['imageCandidate']['url'] as string, credit: String(o['imageCandidate']['credit'] ?? ''), creditLink: String(o['imageCandidate']['creditLink'] ?? '') }
    : null;
  const body = `${mainBody(o['body'])}\n\n${buildAttribution(used, sources)}`;
  const d: Draft = {
    id: `${job.articleId}:d${job.attempt}`, editoria: job.editoria, headline: o['headline'], body, claims, evidenceIds,
    signature: SIGNATURE, // sempre imposta pelo sistema; o modelo não define autoria
    image: primary ? decideImage(primary, cand) : { mode: 'none', reason: 'fonte desconhecida' },
    modelProvider: r.provider, promptVersion: PROMPT_VERSION,
  };
  const chk = runDeterministicChecks(d, job.evidences);
  if (chk.verdict !== 'pass') {
    if (job.attempt + 1 >= MAX_ATTEMPTS) return blocked(job, 'draft', ['max_attempts', ...toBlockers(chk.findings)], chk.findings);
    return next('draft', { ...job, attempt: job.attempt + 1, feedback: chk.findings });
  }
  return next('factcheck', { ...job, draft: d, feedback: undefined });
}

// ---------------- 4. checagem em provedor distinto ----------------
export async function factcheck(deps: StageDeps, job: ArticleJob): Promise<StageOutcome> {
  requireFlag(deps.flags, 'editorial.pipeline.enabled');
  const d = job.draft;
  if (!d) return blocked(job, 'factcheck', ['approval_missing'], [{ code: 'no_draft', message: 'sem rascunho' }]);
  const used = job.evidences.filter((e) => d.evidenceIds.includes(e.id));
  const r = await call(deps, job, 'factcheck', 'factcheck', 'review', 'WF02',
    { claims: d.claims, evidences: untrusted(used), headline: d.headline, body: d.body }, [d.modelProvider]);
  if (!r.ok) return refused(job, 'factcheck', r);
  if (r.provider === d.modelProvider) {
    return blocked(job, 'factcheck', ['cross_provider_check_failed'], [{ code: 'same_provider', message: `checagem veio do mesmo provedor do redator (${r.provider})` }]);
  }
  const vs = isObj(r.output) && Array.isArray(r.output['verdicts']) ? r.output['verdicts'] : null;
  if (!vs) return bad(job, 'factcheck', 'factcheck: esperado {verdicts:[]}');
  const verdicts: FactVerdict[] = [];
  for (const v of vs) {
    if (!isObj(v) || typeof v['claimId'] !== 'string' || !['pass', 'fail', 'inconclusive'].includes(String(v['verdict']))) return bad(job, 'factcheck', 'factcheck: veredito inválido');
    verdicts.push({ claimId: v['claimId'], verdict: v['verdict'] as FactVerdict['verdict'] });
  }
  const findings: Finding[] = [];
  for (const c of d.claims) {
    const v = verdicts.find((x) => x.claimId === c.id);
    if (!v) findings.push({ code: 'unsupported_claim', message: 'claim sem veredito', claimId: c.id });
    else if (v.verdict !== 'pass') findings.push({ code: 'unsupported_claim', message: `veredito ${v.verdict}`, claimId: c.id });
  }
  if (findings.length) return blocked(job, 'factcheck', ['unsupported_claim'], findings);
  return next('review', { ...job, factcheck: { provider: r.provider, model: r.model, verdicts } });
}

// ---------------- 5. revisão (auto_gate_editor) ----------------
export async function review(deps: StageDeps, job: ArticleJob): Promise<StageOutcome> {
  requireFlag(deps.flags, 'editorial.pipeline.enabled');
  const d = job.draft; const fc = job.factcheck;
  if (!d || !fc) return blocked(job, 'review', ['approval_missing'], [{ code: 'missing_prior_stage', message: 'rascunho/checagem ausentes' }]);
  // O gate NÃO confia no estágio anterior: refaz as verificações determinísticas e a independência do provedor.
  const chk = runDeterministicChecks(d, job.evidences);
  if (chk.verdict !== 'pass') return blocked(job, 'review', toBlockers(chk.findings), chk.findings);
  if (fc.provider === d.modelProvider) return blocked(job, 'review', ['cross_provider_check_failed'], [{ code: 'same_provider', message: 'redator e checador no mesmo provedor' }]);
  const ok = d.claims.every((c) => fc.verdicts.some((v) => v.claimId === c.id && v.verdict === 'pass'));
  if (!ok) return blocked(job, 'review', ['unsupported_claim'], [{ code: 'factcheck_incomplete', message: 'nem todo claim aprovado' }]);
  const r = await call(deps, job, 'review', 'review', 'economy', 'WF02', { headline: d.headline, body: d.body, editoria: d.editoria });
  if (!r.ok) return refused(job, 'review', r);
  if (!isObj(r.output) || typeof r.output['approve'] !== 'boolean') return bad(job, 'review', 'review: esperado {approve:boolean}');
  if (!r.output['approve']) {
    const issues = Array.isArray(r.output['issues']) ? r.output['issues'].map(String) : [];
    return blocked(job, 'review', ['approval_missing'], issues.map((m) => ({ code: 'editor_rejected', message: m })));
  }
  return { kind: 'done', event: 'article.approved', data: { ...job, approved: true } };
}

// ---------------- 6. pacote social (WF04; só após article.published) ----------------
export interface PublishedInfo { url: string }

export function utm(articleId: string, channel: string) { return { source: channel, medium: 'social', campaign: `materia-${articleId}` }; }

export async function socialPack(deps: StageDeps, job: ArticleJob, published: PublishedInfo): Promise<StageOutcome> {
  requireFlag(deps.flags, 'editorial.pipeline.enabled');
  const d = job.draft;
  if (!job.approved || !d) return blocked(job, 'social_pack', ['approval_missing'], [{ code: 'not_approved', message: 'matéria não aprovada' }]);
  if (!published.url) return blocked(job, 'social_pack', ['approval_missing'], [{ code: 'not_published', message: 'sem URL publicada' }]);
  const wantIg = deps.flags?.['editorial.social.instagram'] === true;
  const r = await call(deps, job, 'social_pack', 'social_pack', 'economy', 'WF04', { headline: d.headline, body: mainBody(d.body), wantInstagram: wantIg });
  if (!r.ok) return refused(job, 'social_pack', r);
  if (!isObj(r.output) || typeof r.output['linkedin'] !== 'string') return bad(job, 'social_pack', 'social: esperado {linkedin:string}');
  const li = r.output['linkedin'];
  const ig = wantIg && typeof r.output['instagram'] === 'string' ? r.output['instagram'] : undefined;
  const base = `${d.headline}\n${mainBody(d.body)}`;
  const baseNums = new Set(numbersIn(base).map(digitsKey));
  const findings: Finding[] = [...fabricatedReportingFindings(li), ...(ig ? fabricatedReportingFindings(ig) : [])];
  for (const t of [li, ...(ig ? [ig] : [])]) {
    for (const n of numbersIn(t)) if (!baseNums.has(digitsKey(n))) findings.push({ code: 'unsupported_metric', message: `número "${n}" no post não consta na matéria` });
    for (const m of t.matchAll(/["“]([^"”]{12,})["”]/g)) if (!normalizeText(base).includes(normalizeText(m[1]!))) findings.push({ code: 'invented_quote', message: 'citação do post não consta na matéria' });
  }
  if (li.length > 3000) findings.push({ code: 'too_long', message: 'post LinkedIn acima de 3000 caracteres' });
  if (findings.length) return blocked(job, 'social_pack', ['unsupported_claim'], findings);
  const u = utm(job.articleId, 'linkedin');
  const q = `utm_source=${u.source}&utm_medium=${u.medium}&utm_campaign=${u.campaign}`;
  const url = `${published.url}${published.url.includes('?') ? '&' : '?'}${q}`;
  // Menções: nunca publicadas sem verificação -> '@' removido (fallback texto puro).
  const text = li.replace(/@(\w+)/g, '$1');
  const pack: SocialPack = {
    articleId: job.articleId,
    linkedin: { text: `${text}\n\n${url}`, url, utm: u },
    ...(ig ? { instagram: { caption: ig.replace(/@(\w+)/g, '$1') } } : {}),
    image: d.image.mode === 'none' ? { mode: 'none', reason: d.image.reason } : { mode: d.image.mode },
    mentions: [],
    blockers: d.image.mode === 'none' ? ['no_image'] : [],
  };
  return { kind: 'done', event: 'social.pack_ready', data: job, pack };
}

export async function runStage(deps: StageDeps, spec: JobSpec, published?: PublishedInfo): Promise<StageOutcome> {
  switch (spec.stage) {
    case 'triage': return triage(deps, spec.data);
    case 'context': return context(deps, spec.data);
    case 'draft': return draft(deps, spec.data);
    case 'factcheck': return factcheck(deps, spec.data);
    case 'review': return review(deps, spec.data);
    case 'social_pack':
      if (!published) return blocked(spec.data, 'social_pack', ['approval_missing'], [{ code: 'not_published', message: 'pacote social só após article.published' }]);
      return socialPack(deps, spec.data, published);
  }
}
