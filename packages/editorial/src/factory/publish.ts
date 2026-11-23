import type { EditorialFlagOverrides } from '../flags';
import { isEnabled } from '../flags';
import { runDeterministicChecks } from '../rules/rules';
import { draftContentSha256 } from '../publishable';
import { publicArticleUrl } from '../api/published-lookup';
import type { EditorialStore } from '../api/store';

/**
 * Recibo → publicação pelas ROTAS OFICIAIS (a Fábrica nunca grava `articles` nem registra publicação por conta própria).
 * `PublishingPort` é implementada por quem chama as rotas (Studio/Backend); aqui só se orquestra e se confere:
 * gate refeito, hash do recibo = hash do rascunho aprovado, publicação confirmada no registro.
 * Flags: `publicacaoPortal` (publicação disparada pelo CMS/Studio); disparo por worker/agente exige TAMBÉM `publicacaoAutonoma`.
 * Desligadas (padrão): nada é emitido nem publicado; o relatório lista o que está aprovado e esperando.
 */

export type PortResult<T> = ({ ok: true } & T) | { ok: false; code: string; message: string };

export interface PublishingPort {
  /** POST /api/materias/{id}/recibos — devolve o recibo emitido sobre o rascunho aprovado do CMS editorial. */
  issueReceipt(input: { articleId: string; factcheckProvider: string | null }): Promise<PortResult<{ receiptId: string; contentSha256: string }>>;
  /** POST /api/studio/editorial/articles/{id}/publication. */
  publish(input: { articleId: string; receiptId: string; url: string }): Promise<PortResult<{ outbox?: string }>>;
}

export interface PublishDeps {
  store: EditorialStore;
  port: PublishingPort;
  /** URL base do Portal (ex.: https://loyaltynews.example); a URL pública é `{base}/noticia/{slug}`. */
  siteBaseUrl: string;
  flags?: EditorialFlagOverrides;
  /** Quem dispara: 'studio' (pessoa com sessão) ou 'worker' (agente/worker: exige também publicacaoAutonoma). */
  trigger: 'studio' | 'worker';
}
export interface PublishRow { articleId: string; slug: string | null; outcome: 'published' | 'waiting_flag' | 'skipped' | 'failed'; code?: string; message?: string; receiptId?: string; url?: string }
export interface PublishReport { rows: PublishRow[]; flagsOk: boolean; haltedBy: string | null }

export async function publishApproved(deps: PublishDeps, opts: { maxArticles?: number; onlyIds?: readonly string[] } = {}): Promise<PublishReport> {
  const approved = (await deps.store.listArticles())
    .filter((a) => a.status === 'aprovado' && !!a.draft && (!opts.onlyIds || opts.onlyIds.includes(a.articleId)))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, opts.maxArticles ?? Number.MAX_SAFE_INTEGER);
  const flagsOk = isEnabled('publicacaoPortal', deps.flags) && (deps.trigger === 'studio' || isEnabled('publicacaoAutonoma', deps.flags));
  const report: PublishReport = { rows: [], flagsOk, haltedBy: null };
  for (const rec of approved) {
    const draft = rec.draft!;
    const row: PublishRow = { articleId: rec.articleId, slug: draft.slug ?? null, outcome: 'skipped' };
    report.rows.push(row);
    if (!flagsOk) { row.outcome = 'waiting_flag'; row.message = deps.trigger === 'worker' ? 'exige publicacaoPortal e publicacaoAutonoma' : 'exige publicacaoPortal'; continue; }
    if (report.haltedBy) { row.message = `rodada interrompida: ${report.haltedBy}`; continue; }
    // gate refeito: o que foi aprovado ontem precisa continuar aprovável hoje (rascunho adulterado, checagem sem provedor distinto...)
    const chk = runDeterministicChecks(draft, rec.evidences, { notices: rec.notices?.map((n) => n.text) ?? [] });
    const fc = rec.factcheck;
    const independent = !!fc && fc.provider !== draft.modelProvider;
    const allPass = !!fc && draft.claims.length > 0 && draft.claims.every((c) => fc.verdicts.some((v) => v.claimId === c.id && v.verdict === 'pass'));
    if (chk.verdict !== 'pass' || !independent || !allPass) {
      row.outcome = 'failed'; row.code = 'gate_failed'; row.message = chk.findings.map((f) => f.code).join(',') || 'checagem de fatos incompleta ou do mesmo provedor';
      continue;
    }
    const expected = draftContentSha256(rec);
    const url = publicArticleUrl(deps.siteBaseUrl, draft.slug);
    const receipt = await deps.port.issueReceipt({ articleId: rec.articleId, factcheckProvider: fc?.provider ?? null });
    if (!receipt.ok) { row.outcome = 'failed'; row.code = receipt.code; row.message = receipt.message; if (receipt.code === 'FEATURE_DISABLED') report.haltedBy = receipt.code; continue; }
    if (receipt.contentSha256 !== expected) {
      row.outcome = 'failed'; row.code = 'receipt_hash_mismatch'; row.message = 'o recibo emitido não cobre o rascunho aprovado (hash diferente)';
      report.haltedBy = 'receipt_hash_mismatch'; // sinal de projeção divergente: para a rodada em vez de publicar
      continue;
    }
    row.receiptId = receipt.receiptId; row.url = url;
    const pub = await deps.port.publish({ articleId: rec.articleId, receiptId: receipt.receiptId, url });
    if (!pub.ok) { row.outcome = 'failed'; row.code = pub.code; row.message = pub.message; if (pub.code === 'FEATURE_DISABLED') report.haltedBy = pub.code; continue; }
    // confirmação no registro editorial: só vale se a matéria realmente virou publicada com o MESMO hash
    const after = await deps.store.getArticle(rec.articleId);
    if (after?.status !== 'publicado' || after.publication?.contentSha256 !== expected) {
      row.outcome = 'failed'; row.code = 'not_confirmed'; row.message = 'a rota respondeu ok, mas o registro editorial não mostra a publicação esperada';
      report.haltedBy = 'not_confirmed';
      continue;
    }
    row.outcome = 'published';
  }
  return report;
}

// ------------------------------------------------------------------------------------------------------------------
// Cliente HTTP das rotas oficiais. O transporte (fetch com a sessão/credencial do operador) é injetado: este pacote não
// faz rede e não guarda credenciais.

export interface HttpRequest { method: 'GET' | 'POST'; path: string; body?: unknown }
export interface HttpResponse { status: number; body: unknown }
export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

const errOf = (r: HttpResponse): { code: string; message: string } => {
  const e = (r.body as { error?: { code?: string; message?: string } } | null)?.error;
  return { code: e?.code ?? `HTTP_${r.status}`, message: e?.message ?? `resposta ${r.status}` };
};

export function createHttpPublishingPort(transport: HttpTransport): PublishingPort {
  return {
    async issueReceipt({ articleId, factcheckProvider }) {
      const checagens = [
        { tipo: 'fatos', resultado: 'aprovado', ...(factcheckProvider ? { autorModelo: factcheckProvider } : {}) },
        { tipo: 'direitos', resultado: 'aprovado' }, { tipo: 'editor', resultado: 'aprovado' }, { tipo: 'originalidade', resultado: 'aprovado' }, { tipo: 'classe_de_dado', resultado: 'aprovado' },
      ];
      const r = await transport({ method: 'POST', path: `/api/materias/${encodeURIComponent(articleId)}/recibos`, body: { checagens } });
      if (r.status !== 200 && r.status !== 201) return { ok: false, ...errOf(r) };
      const data = (r.body as { data?: { id?: string; conteudoSha256?: string } } | null)?.data;
      if (!data?.id || !data.conteudoSha256) return { ok: false, code: 'bad_receipt_response', message: 'resposta de recibo sem id ou hash' };
      return { ok: true, receiptId: data.id, contentSha256: data.conteudoSha256 };
    },
    async publish({ articleId, receiptId, url }) {
      const r = await transport({ method: 'POST', path: `/api/studio/editorial/articles/${encodeURIComponent(articleId)}/publication`, body: { receiptId, url } });
      if (r.status !== 200 && r.status !== 201) return { ok: false, ...errOf(r) };
      return { ok: true };
    },
  };
}
