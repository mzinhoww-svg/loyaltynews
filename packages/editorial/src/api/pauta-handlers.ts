import { apiError } from '@ln/contracts';
import { PautaAutoral } from '../factory/autoral';
import { primarySourceFor } from '../factory/anchor';
import { SourceRegistry } from '../sources/registry';
import { audit, authorize, bad, fail, isErr, ok, parse } from './common';
import type { ApiResponse, HandlerCtx } from './common';

/**
 * Pauta AUTORAL (DP-29) como fluxo do Studio. A pauta é proposta por pessoa da redação (admin, editor-chefe ou editor) e fica na fila
 * do EditorialStore (trilha de auditoria, sem tabela nova): `pauta.submitted` (alvo = id da pauta, detalhe = JSON) e, depois que o
 * worker processa, `pauta.processed`. Quem processa é o worker (runAutoralQueue), nunca a rota: a rota só registra e lista.
 * O resultado é uma matéria `aprovado` ou `bloqueado` na fila de revisão comum; nada é publicado por aqui.
 */
export const PAUTA_SUBMITTED = 'pauta.submitted';
export const PAUTA_PROCESSED = 'pauta.processed';

export interface PautaView {
  id: string; titulo: string; angulo: string; formato: string; editoria: string; ancoras: string[];
  submetidaPor: string | null; em: string;
  estado: 'pendente' | 'processada';
  resultado?: { status: string; articleId: string | null; blockers: string[]; findings: string[]; em: string };
}

type Submitted = { pauta: PautaAutoral };

export async function readPautas(store: HandlerCtx['store']): Promise<PautaView[]> {
  const log = await store.listAudit();
  const done = new Map<string, { at: string; detail: string }>();
  for (const a of log) if (a.action === PAUTA_PROCESSED && a.detail) done.set(a.target, { at: a.at, detail: a.detail });
  const out: PautaView[] = [];
  const seen = new Set<string>();
  for (const a of log) {
    if (a.action !== PAUTA_SUBMITTED || !a.detail || seen.has(a.target)) continue;
    let p: PautaAutoral;
    try { p = (JSON.parse(a.detail) as Submitted).pauta; } catch { continue; }
    seen.add(a.target);
    const d = done.get(a.target);
    let resultado: PautaView['resultado'];
    if (d) {
      try { const r = JSON.parse(d.detail) as { status?: string; articleId?: string | null; blockers?: string[]; findings?: string[] }; resultado = { status: r.status ?? 'desconhecido', articleId: r.articleId ?? null, blockers: r.blockers ?? [], findings: r.findings ?? [], em: d.at }; }
      catch { resultado = { status: 'desconhecido', articleId: null, blockers: [], findings: [], em: d.at }; }
    }
    out.push({ id: p.id, titulo: p.titulo, angulo: p.angulo, formato: p.formato, editoria: p.editoria, ancoras: p.ancoras, submetidaPor: a.userId, em: a.at, estado: d ? 'processada' : 'pendente', ...(resultado ? { resultado } : {}) });
  }
  return out.sort((x, y) => y.em.localeCompare(x.em));
}

/** POST /pautas: registra a pauta (fica pendente). Valida o formato e que toda âncora cai numa fonte PRIMÁRIA do cadastro. */
export async function submitPauta(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ id: string; estado: 'pendente' }>> {
  const a = authorize(ctx, 'pauta.submit'); if (isErr(a)) return fail(a);
  const p = parse(PautaAutoral, input); if (bad(p)) return fail(p);
  if (!ctx.sources) return fail(apiError('UNAVAILABLE', 'cadastro de fontes indisponível'));
  const pauta = p.data;
  // âncora precisa pertencer a uma fonte primária do cadastro (a habilitação é conferida pelo worker na hora de coletar)
  const cadastro = new SourceRegistry(ctx.sources.all().map((s) => ({ ...s, enabled: true, termsStatus: 'approved' as const, urlVerified: true, paywall: 'none' as const })));
  const reasons = pauta.ancoras.filter((u) => !primarySourceFor(cadastro, u)).map((u) => ({ path: 'ancoras', message: `sem fonte primária no cadastro para ${u}` }));
  if (reasons.length) return fail(apiError('INVALID_INPUT', 'âncora fora das fontes primárias do cadastro', reasons));
  if ((await ctx.store.listAudit()).some((x) => x.action === PAUTA_SUBMITTED && x.target === pauta.id)) return fail(apiError('CONFLICT', 'já existe pauta com este id'));
  await audit(ctx, a.userId, PAUTA_SUBMITTED, pauta.id, JSON.stringify({ pauta } satisfies Submitted));
  return ok({ id: pauta.id, estado: 'pendente' as const }, 201);
}

/** GET /pautas: fila (pendentes e processadas, com o resultado quando houver). */
export async function listPautas(ctx: HandlerCtx, _input: unknown): Promise<ApiResponse<{ items: PautaView[] }>> {
  const a = authorize(ctx, 'pauta.read'); if (isErr(a)) return fail(a);
  return ok({ items: await readPautas(ctx.store) });
}
