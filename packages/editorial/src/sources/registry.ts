import type { Editoria, Source } from '../types.ts';
import { EDITORIAS } from '../types.ts';

export type Eligibility = { ok: true } | { ok: false; reasons: string[] };

/** Fonte só é coletável com habilitação explícita, termos aprovados, URL conferida e sem login/paywall. */
export function eligibility(s: Source): Eligibility {
  const reasons: string[] = [];
  if (!s.enabled) reasons.push('source_disabled');
  if (s.termsStatus !== 'approved') reasons.push(`terms_${s.termsStatus}`);
  if (!s.urlVerified) reasons.push('url_unverified');
  if (s.paywall === 'login' || s.paywall === 'metered') reasons.push(`paywall_${s.paywall}`);
  if (s.paywall === 'unknown') reasons.push('paywall_unknown');
  if (!s.robotsRespected) reasons.push('robots_not_respected');
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

export class SourceRegistry {
  private readonly byId = new Map<string, Source>();
  constructor(sources: Source[]) {
    for (const s of sources) this.add(s);
  }
  add(s: Source): void {
    if (this.byId.has(s.id)) throw new Error(`duplicate source id: ${s.id}`);
    if (!s.host || /[\s*/]/.test(s.host)) throw new Error(`invalid host for ${s.id}`);
    for (const e of s.editorias) if (!EDITORIAS.includes(e)) throw new Error(`unknown editoria ${e} in ${s.id}`);
    this.byId.set(s.id, s);
  }
  get(id: string): Source | undefined { return this.byId.get(id); }
  all(): Source[] { return [...this.byId.values()]; }
  byEditoria(e: Editoria): Source[] { return this.all().filter((s) => s.editorias.includes(e)); }
  collectable(): Source[] { return this.all().filter((s) => eligibility(s).ok); }
  /** Editorias sem nenhuma fonte coletável (relatório honesto de cobertura). */
  uncovered(): Editoria[] { return EDITORIAS.filter((e) => !this.collectable().some((s) => s.editorias.includes(e))); }
}
