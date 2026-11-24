import { z } from 'zod';
import { apiError } from '@ln/contracts';
import { EDITORIAS } from '../types';
import type { Source } from '../types';
import { eligibility } from '../sources/registry';
import { effectiveSource, sourceFingerprint } from '../sources/state';
import type { SourceReview, SourceState } from './store';
import { audit, authorize, bad, fail, isErr, ok, parse } from './common';
import type { ApiResponse, HandlerCtx } from './common';

/**
 * Fontes: revisão e habilitação como fluxo do Studio. Habilitar NUNCA é automático:
 * o cadastro é imutável (sempre enabled=false); o estado efetivo vem de SourceState, gravado só por estes handlers.
 */

export interface SourceView {
  id: string; nome: string; kind: string; host: string; pathPrefix: string | null; editorias: string[];
  listingUrl: string | null; feedUrl: string | null; termsUrl: string | null;
  pesquisa: { nivel: string | null; pesquisadoPor: string | null; robots: string | null; trechoTermos: string | null; imagens: string | null };
  /** 'via-provedor' = lida por serviço de extração, com risco aceito pelo proprietário (a tela deve destacar). */
  acesso: string;
  habilitada: boolean; termsStatus: string; urlVerificada: boolean; paywall: string;
  elegivel: boolean; motivosInelegivel: string[];
  /** DP-51: avisos de segurança da fonte (paywall/login, inacessível na pesquisa). Habilitar com aviso exige a confirmação explícita do administrador. */
  riscos: string[];
  revisao: { revisor: string; em: string; termos: string; vencida: boolean; observacao: string | null; direta: boolean } | null;
}

/** Avisos de segurança que NÃO são de termos: o administrador decide, mas só depois de ver o aviso (confirmarRisco). */
export function riscosDaFonte(src: Source): string[] {
  const r: string[] = [];
  if (src.paywall === 'login') r.push('exige login');
  if (src.paywall === 'metered') r.push('limite de leituras (paywall)');
  if (src.verification?.level === 'inacessivel' && src.acesso !== 'via-provedor') r.push('inacessível na pesquisa');
  return r;
}

function viewOf(src: Source, st: SourceState | undefined): SourceView {
  const eff = effectiveSource(src, st);
  const el = eligibility(eff);
  return {
    id: src.id, nome: src.name, kind: src.kind, host: src.host, pathPrefix: src.pathPrefix ?? null, editorias: src.editorias,
    listingUrl: src.listingUrl, feedUrl: src.feedUrl, termsUrl: src.termsUrl,
    pesquisa: {
      nivel: src.verification?.level ?? null, pesquisadoPor: src.verification?.researchedBy ?? null, robots: src.verification?.robots ?? null,
      trechoTermos: src.verification?.termsExcerpt ?? null, imagens: src.verification?.imageRightsNote ?? null,
    },
    acesso: src.acesso ?? 'padrao', habilitada: eff.enabled, termsStatus: eff.termsStatus, urlVerificada: eff.urlVerified, paywall: eff.paywall,
    elegivel: el.ok, motivosInelegivel: el.ok ? [] : el.reasons,
    riscos: riscosDaFonte(src),
    revisao: st?.review
      ? { revisor: st.review.reviewer, em: st.review.at, termos: st.review.termsStatus, vencida: st.review.fingerprint !== sourceFingerprint(src), observacao: st.review.termsNote || null, direta: st.review.direta === true }
      : null,
  };
}

const EditoriaIn = z.enum(EDITORIAS as unknown as [string, ...string[]]);

export async function listSources(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ items: SourceView[] }>> {
  const a = authorize(ctx, 'source.read'); if (isErr(a)) return fail(a);
  const p = parse(z.object({ editoria: EditoriaIn.optional(), somenteElegiveis: z.boolean().optional() }), input); if (bad(p)) return fail(p);
  if (!ctx.sources) return fail(apiError('UNAVAILABLE', 'cadastro de fontes indisponível'));
  const states = new Map((await ctx.store.listSourceStates()).map((x) => [x.sourceId, x]));
  let items = ctx.sources.all().map((s) => viewOf(s, states.get(s.id)));
  const ed = p.data.editoria;
  if (ed) items = items.filter((i) => i.editorias.includes(ed));
  if (p.data.somenteElegiveis) items = items.filter((i) => i.elegivel);
  return ok({ items });
}

const SourceReviewIn = z.object({
  sourceId: z.string().min(1).max(128),
  termsStatus: z.enum(['approved', 'denied']),
  /** O que o revisor conferiu nos termos oficiais (não basta o trecho da pesquisa). */
  termsNote: z.string().trim().min(20).max(2000),
  urlVerified: z.boolean(),
  robotsChecked: z.boolean(),
  paywall: z.enum(['none', 'login', 'metered']),
});

/**
 * Registra a revisão humana (termos conferidos, URL verificada, robots, paywall). NÃO habilita.
 * Revisor ≠ pesquisador (verification.researchedBy precisa existir); fonte inacessível não é aprovável;
 * aprovar exige URL verificada, robots conferido e paywall 'none'. Uma nova revisão sempre desliga a fonte.
 */
export async function reviewSource(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<SourceView>> {
  const a = authorize(ctx, 'source.review'); if (isErr(a)) return fail(a);
  const p = parse(SourceReviewIn, input); if (bad(p)) return fail(p);
  if (!ctx.sources) return fail(apiError('UNAVAILABLE', 'cadastro de fontes indisponível'));
  const src = ctx.sources.get(p.data.sourceId);
  if (!src) return fail(apiError('NOT_FOUND', 'fonte não encontrada'));
  const researcher = src.verification?.researchedBy;
  if (!researcher) return fail(apiError('BLOCKED', 'pesquisador da fonte desconhecido: não é possível garantir revisor independente'));
  if (a.userId === researcher) return fail(apiError('BLOCKED', 'o revisor não pode ser o mesmo que pesquisou a fonte'));
  if (p.data.termsStatus === 'approved') {
    if (src.verification?.level === 'inacessivel') {
      // DP-31/DP-32: só com acesso 'via-provedor' cadastrado E nota de revisão que cite a DP-31 ou a DP-32 (risco aceito pelo proprietário); senão segue não aprovável.
      if (src.acesso !== 'via-provedor') return fail(apiError('BLOCKED', 'fonte inacessível na pesquisa: não aprovável'));
      if (!/DP-3[12]/i.test(p.data.termsNote)) return fail(apiError('BLOCKED', 'fonte via provedor: a nota da revisão precisa citar a DP-31 ou a DP-32 (risco aceito pelo proprietário)'));
    }
    if (!p.data.urlVerified || !p.data.robotsChecked) return fail(apiError('BLOCKED', 'aprovação exige URL verificada e robots.txt conferido'));
    if (p.data.paywall !== 'none') return fail(apiError('BLOCKED', 'fonte com login/paywall não pode ser aprovada'));
  }
  const at = ctx.now().toISOString();
  const review: SourceReview = {
    reviewer: a.userId, at, termsStatus: p.data.termsStatus, termsNote: p.data.termsNote, urlVerified: p.data.urlVerified,
    robotsChecked: p.data.robotsChecked, paywall: p.data.paywall, fingerprint: sourceFingerprint(src),
  };
  const st: SourceState = {
    sourceId: src.id, enabled: false, termsStatus: review.termsStatus, urlVerified: review.urlVerified, paywall: review.paywall,
    review, updatedAt: at, updatedBy: a.userId,
  };
  await ctx.store.putSourceState(st);
  await audit(ctx, a.userId, 'source.review', src.id, review.termsStatus);
  return ok(viewOf(src, st));
}

const EnableIn = z.object({
  sourceId: z.string().min(1).max(128),
  enabled: z.boolean(),
  /** DP-51: habilitação DIRETA do administrador (um clique): grava a revisão implícita aprovada, sem exigir revisão prévia dos termos. */
  direto: z.boolean().optional(),
  /** Observação OPCIONAL (sem mínimo) que fica na revisão implícita. */
  observacao: z.string().trim().max(2000).optional(),
  /** Aceite explícito dos avisos de segurança da fonte (paywall/login, inacessível). */
  confirmarRisco: z.boolean().optional(),
});

/**
 * Habilita/desabilita. Desabilitar é sempre permitido (fail-safe). Habilitar exige revisão registrada, ATUAL
 * (mesma impressão digital), aprovada, de revisor ≠ pesquisador, e a fonte efetiva precisa passar em eligibility().
 */
export async function setSourceEnabled(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<SourceView>> {
  const p = parse(EnableIn, input); if (bad(p)) return fail(p);
  const a = authorize(ctx, p.data.enabled ? 'source.enable' : 'source.disable'); if (isErr(a)) return fail(a);
  if (!ctx.sources) return fail(apiError('UNAVAILABLE', 'cadastro de fontes indisponível'));
  const src = ctx.sources.get(p.data.sourceId);
  if (!src) return fail(apiError('NOT_FOUND', 'fonte não encontrada'));
  const st = await ctx.store.getSourceState(src.id);
  const at = ctx.now().toISOString();
  if (!p.data.enabled) {
    const next: SourceState = st
      ? { ...st, enabled: false, updatedAt: at, updatedBy: a.userId }
      : { sourceId: src.id, enabled: false, termsStatus: 'pending', urlVerified: false, paywall: src.paywall, review: null, updatedAt: at, updatedBy: a.userId };
    await ctx.store.putSourceState(next);
    await audit(ctx, a.userId, 'source.disable', src.id);
    return ok(viewOf(src, next));
  }
  if (p.data.direto) {
    // DP-51: só o administrador habilita direto. A revisão implícita registra quem e quando; recusas de segurança que não são de termos continuam.
    if (!a.roles.includes('admin')) return fail(apiError('FORBIDDEN', 'a habilitação direta é do administrador'));
    const riscos = riscosDaFonte(src);
    if (riscos.length && p.data.confirmarRisco !== true) return fail(apiError('BLOCKED', `a fonte tem aviso de segurança (${riscos.join('; ')}): confirme para habilitar mesmo assim`, { riscos, precisaConfirmar: true }));
    const review: SourceReview = {
      reviewer: a.userId, at, termsStatus: 'approved',
      termsNote: p.data.observacao || 'Habilitação direta pelo administrador (DP-51), sem revisão formal dos termos.',
      urlVerified: true, robotsChecked: true, paywall: 'none', fingerprint: sourceFingerprint(src), direta: true,
      ...(riscos.length ? { riscoAceito: riscos } : {}),
    };
    const direto: SourceState = { sourceId: src.id, enabled: true, termsStatus: 'approved', urlVerified: true, paywall: 'none', review, updatedAt: at, updatedBy: a.userId };
    const elD = eligibility(effectiveSource(src, direto));
    if (!elD.ok) return fail(apiError('BLOCKED', 'fonte inelegível', { reasons: elD.reasons }));
    await ctx.store.putSourceState(direto);
    await audit(ctx, a.userId, 'source.enable_direct', src.id, `DP-51 por ${a.userId}${riscos.length ? `; risco aceito: ${riscos.join(', ')}` : ''}${p.data.observacao ? `; observação: ${p.data.observacao.slice(0, 200)}` : ''}`);
    return ok(viewOf(src, direto));
  }
  const rv = st?.review;
  if (!st || !rv) return fail(apiError('BLOCKED', 'sem revisão registrada: revise a fonte antes de habilitar'));
  if (rv.fingerprint !== sourceFingerprint(src)) return fail(apiError('BLOCKED', 'revisão vencida: a definição da fonte mudou desde a revisão'));
  if (rv.termsStatus !== 'approved' || !rv.urlVerified || !rv.robotsChecked || rv.paywall !== 'none') return fail(apiError('BLOCKED', 'a revisão não aprova a fonte'));
  const researcher = src.verification?.researchedBy;
  if (!researcher || rv.reviewer === researcher) return fail(apiError('BLOCKED', 'o revisor precisa ser diferente do pesquisador'));
  const candidate: SourceState = { ...st, enabled: true, updatedAt: at, updatedBy: a.userId };
  const el = eligibility(effectiveSource(src, candidate));
  if (!el.ok) return fail(apiError('BLOCKED', 'fonte inelegível', { reasons: el.reasons }));
  await ctx.store.putSourceState(candidate);
  await audit(ctx, a.userId, 'source.enable', src.id, `revisão de ${rv.reviewer}`);
  return ok(viewOf(src, candidate));
}
