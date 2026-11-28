import { Collector } from '../collector/collector';
import type { Skip } from '../collector/collector';
import { canonicalUrl, Deduper, sha256 } from '../dedupe/dedupe';
import { eligibility, SourceRegistry } from '../sources/registry';
import { effectiveSource, resolveEffectiveSources } from '../sources/state';
import type { Editoria, Evidence, Source } from '../types';
import type { EditorialStore } from '../api/store';

/**
 * Coleta das fontes HABILITADAS (revisão humana registrada, termos aprovados, URL verificada: ver source-handlers).
 * Só lê fontes elegíveis do estado EFETIVO; coleta determinística (sem LLM); dedupe contra o que já está no banco e dentro do lote.
 */

export interface CollectedItem { articleId: string; editoria: Editoria; sourceId: string; evidence: Evidence }
export interface SourceCollectReport {
  sourceId: string;
  status: 'collected' | 'not_eligible' | 'no_feed' | 'error';
  reasons?: string[];
  evidences: number; skipped: Skip[];
}
export interface CollectOutcome {
  items: CollectedItem[];
  /** Itens descartados por já existirem (mesma URL canônica, mesmo hash ou texto muito parecido). */
  duplicates: Array<{ url: string; of: string; reason: 'same_url' | 'same_hash' | 'similar' | 'already_in_store' }>;
  sources: SourceCollectReport[];
  /** Registro efetivo (estado das fontes aplicado): é ele que o pipeline usa para checar direitos na triagem. */
  effective: SourceRegistry;
}

/** Id da matéria da Fábrica: determinístico pela URL canônica (a mesma página nunca vira duas matérias). */
export const articleIdFor = (canonical: string): string => `art_${sha256(canonical).slice(0, 20)}`;

export async function collectFromSources(
  deps: { store: EditorialStore; registry: SourceRegistry; collector: Collector },
  opts: { limitPerSource?: number; onlySourceIds?: readonly string[] } = {},
): Promise<CollectOutcome> {
  const effective = new SourceRegistry(await resolveEffectiveSources(deps.registry, deps.store));
  const known = await deps.store.listArticles();
  const dedupe = new Deduper();
  const knownUrls = new Set<string>();
  for (const a of known) for (const e of a.evidences) {
    knownUrls.add(e.canonicalUrl);
    dedupe.add({ id: a.articleId, url: e.canonicalUrl, title: e.title, text: e.text });
  }
  const out: CollectOutcome = { items: [], duplicates: [], sources: [], effective };
  const seenIds = new Set<string>(known.map((a) => a.articleId));
  for (const s of effective.all()) {
    if (opts.onlySourceIds && !opts.onlySourceIds.includes(s.id)) continue;
    const el = eligibility(s);
    if (!el.ok) continue; // só relatamos o que foi tentado; o painel de fontes mostra o motivo de inelegibilidade
    // A rodada é longa: desabilitar a fonte no Studio vale antes de a coleta DELA começar. Só restringe: quem não era elegível no início continua fora.
    const agora = effectiveSource(deps.registry.get(s.id)!, await deps.store.getSourceState(s.id));
    const ainda = eligibility(agora);
    if (!ainda.ok) { out.sources.push({ sourceId: s.id, status: 'not_eligible', reasons: ainda.reasons, evidences: 0, skipped: [] }); continue; }
    out.sources.push(await collectOne(deps.collector, agora, opts.limitPerSource ?? 20, out, dedupe, knownUrls, seenIds));
  }
  return out;
}

async function collectOne(
  collector: Collector, s: Source, limit: number, out: CollectOutcome, dedupe: Deduper, knownUrls: Set<string>, seenIds: Set<string>,
): Promise<SourceCollectReport> {
  if (!s.feedUrl && !s.sitemapUrl && s.acesso !== 'via-provedor') return { sourceId: s.id, status: 'no_feed', evidences: 0, skipped: [] };
  let res;
  try { res = s.feedUrl || s.acesso === 'via-provedor' ? await collector.collectFeed(s, limit) : await collector.collectSitemap(s, limit); } catch (e) {
    // flag desligada (FlagDisabled) é decisão do dono e sobe; qualquer outra falha de uma fonte não derruba as demais
    if (e instanceof Error && e.name !== 'FlagDisabled' && !/flag desligada/.test(e.message)) {
      return { sourceId: s.id, status: 'error', reasons: [e.message], evidences: 0, skipped: [] };
    }
    throw e;
  }
  for (const ev of res.evidences) {
    const canonical = canonicalUrl(ev.canonicalUrl);
    const id = articleIdFor(canonical);
    if (seenIds.has(id) || knownUrls.has(canonical)) { out.duplicates.push({ url: ev.url, of: id, reason: 'already_in_store' }); continue; }
    const m = dedupe.add({ id, url: canonical, title: ev.title, text: ev.text });
    if (m) { out.duplicates.push({ url: ev.url, of: m.of, reason: m.reason }); continue; }
    seenIds.add(id);
    out.items.push({ articleId: id, editoria: s.editorias[0] ?? 'mercado', sourceId: s.id, evidence: ev });
  }
  return { sourceId: s.id, status: 'collected', evidences: res.evidences.length, skipped: res.skipped };
}
