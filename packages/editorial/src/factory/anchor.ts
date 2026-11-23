import { stopsCollection } from '../collector/collector';
import type { Collector, Skip } from '../collector/collector';
import { eligibility, type SourceRegistry } from '../sources/registry';
import { canonicalUrl } from '../dedupe/dedupe';
import { sourceTier } from '../types';
import type { Evidence, Source } from '../types';

/**
 * Âncora em fonte primária (DP-29): um post de blog/imprensa de nicho (fonte SECUNDÁRIA) só vira matéria se os fatos forem
 * confirmados por fonte primária. A âncora vem dos LINKS DO PRÓPRIO POST que apontam para páginas de fontes primárias
 * HABILITADAS (RI, regulador, governo, associação, sala de imprensa): a fábrica coleta essas páginas pelo coletor normal
 * (robots, ritmo, pathPrefix, anti-SSRF) e as junta às evidências. Nada é inventado nem buscado fora dos links do post.
 */
export const MAX_ANCHORS = 3;

export interface AnchorResult { anchors: Evidence[]; skipped: Skip[]; considered: number }

/** Fonte primária habilitada e elegível que cobre a URL (mesmo host e prefixo de caminho). */
export function primarySourceFor(registry: SourceRegistry, url: string): Source | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
  return registry.all().find((s) => {
    if (sourceTier(s.kind) !== 'primary' || !eligibility(s).ok || s.host.toLowerCase() !== u.host.toLowerCase()) return false;
    const prefix = s.pathPrefix ?? '';
    return !prefix || u.pathname === prefix || u.pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
  });
}

export async function anchorEvidences(collector: Collector, registry: SourceRegistry, evidence: Evidence, max = MAX_ANCHORS): Promise<AnchorResult> {
  const out: AnchorResult = { anchors: [], skipped: [], considered: 0 };
  if (evidence.sourceTier !== 'secondary') return out;
  const seen = new Set<string>([canonicalUrl(evidence.canonicalUrl)]);
  for (const link of evidence.outboundLinks ?? []) {
    if (out.anchors.length >= max) break;
    const src = primarySourceFor(registry, link);
    if (!src) continue;
    let key: string;
    try { key = canonicalUrl(link); } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.considered++;
    const r = await collector.collectUrl(src, link);
    if (r.evidence && !r.evidence.suspicious) out.anchors.push(r.evidence);
    else if (r.skip) {
      out.skipped.push(r.skip);
      if (stopsCollection(r.skip)) break;
    } else if (r.evidence?.suspicious) out.skipped.push({ url: link, code: 'gated', detail: 'âncora suspeita (instrução embutida): descartada' });
  }
  return out;
}
