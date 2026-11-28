import type { ArticleRecord, EditorialStore } from '../api/store';
import type { Evidence } from '../types';
import { INBOX_FINDING } from './inbox';

/**
 * Prazo e retirada do texto bruto coletado (parecer 64). Vale para o item que está SÓ na caixa de pautas (sem rascunho): é onde o
 * texto fica guardado sem uso. Matéria já redigida não é tocada aqui. Ficam endereço, datas e impressão digital, que bastam para
 * não coletar a mesma página de novo.
 */
export const RAW_TEXT_RETENTION_DAYS = 7;
export const RAW_TEXT_ACTION = 'collector.raw_text_removed';

const inboxOnly = (a: ArticleRecord): boolean => a.status === 'rascunho' && !a.draft && a.findings.some((f) => f.code === INBOX_FINDING);

async function strip(store: EditorialStore, now: Date, match: (e: Evidence) => boolean, dropTitle: boolean, why: string, dryRun = false): Promise<number> {
  let removed = 0;
  for (const a of await store.listArticles()) {
    if (!inboxOnly(a)) continue;
    let touched = 0;
    const evidences = a.evidences.map((e) => {
      if (!match(e) || !(e.text || e.outboundLinks || (dropTitle && e.title))) return e;
      touched += 1;
      const rest: Evidence = { ...e, text: '' };
      delete rest.outboundLinks;
      if (dropTitle) rest.title = '';
      return rest;
    });
    if (!touched) continue;
    removed += touched;
    if (dryRun) continue;
    const findings = [...a.findings.filter((f) => f.code !== 'texto_bruto_apagado'), { code: 'texto_bruto_apagado', message: why }];
    await store.putArticle({ ...a, evidences, findings, updatedAt: now.toISOString() });
  }
  if (removed && !dryRun) await store.appendAudit({ at: now.toISOString(), userId: null, action: RAW_TEXT_ACTION, target: 'collector', detail: `${why}; evidências: ${removed}` });
  return removed;
}

/** Mesma página para um pedido de retirada: ignora `www`, barra final, fragmento e parâmetros de rastreamento (os demais contam). */
export function samePage(url: string): string {
  try {
    const u = new URL(url);
    const query = [...u.searchParams].filter(([k]) => !/^(utm_|fbclid$|gclid$)/i.test(k)).map(([k, v]) => `${k}=${v}`).sort().join('&');
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}?${query}`;
  } catch { return url; }
}

/** Apaga o texto e os links dos itens da caixa coletados há mais de `days` dias. */
export function purgeRawText(store: EditorialStore, now: Date, days: number = RAW_TEXT_RETENTION_DAYS): Promise<number> {
  const limit = now.getTime() - days * 86_400_000;
  return strip(store, now, (e) => Date.parse(e.fetchedAt) < limit, false, `prazo de ${days} dias do texto bruto`);
}

/** Pedido de retirada: apaga já o texto, os links, o título dos itens da caixa de uma fonte ou de um endereço. */
export async function withdrawCollected(store: EditorialStore, now: Date, what: { sourceId: string } | { url: string }, opts: { dryRun?: boolean } = {}): Promise<number> {
  const match = 'sourceId' in what ? (e: Evidence) => e.sourceId === what.sourceId : (e: Evidence) => [e.url, e.canonicalUrl].some((u) => samePage(u) === samePage(what.url));
  return strip(store, now, match, true, 'pedido de retirada', opts.dryRun === true);
}
