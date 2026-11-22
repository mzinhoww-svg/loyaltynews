// Rotação ponderada de anúncios com contagem de impressões servidas/visíveis e cliques válidos.
// Regras (Blueprint v2.0 §4): sem inflar impressões por auto-refresh; excluir bots e tráfego interno; fallback house ad.
export interface Creative {
  id: string; campaignId: string; positionId: string;
  /** Peso relativo (>0). Pesos iguais => share of voice igual (ex.: 25% no TOP com 4 anunciantes). */
  weight: number;
  startDate: string; endDate: string; // YYYY-MM-DD inclusivos
  /** Somente criativos aprovados e de campanha ativa são elegíveis. */
  approved: boolean; campaignActive: boolean;
  label?: 'publicidade'; // publieditoriais sempre rotulados
}
export interface ServeRequest {
  positionId: string; today: string; pageViewId: string;
  isBot?: boolean; isInternal?: boolean;
}
export interface ServeResult { kind: 'creative' | 'house' | 'ignored'; creativeId: string | null; impressionId: string | null; counted: boolean; reason?: string }

export interface DeliveryCounters { served: number; visible: number; clicks: number; ignoredBotOrInternal: number; refreshSuppressed: number }

export class AdServer {
  private creatives: Creative[] = [];
  private credit = new Map<string, number>(); // smooth weighted round-robin por posição
  private views = new Map<string, string>();   // `${pageViewId}|${positionId}` -> impressionId
  private impressionCreative = new Map<string, string>();
  private visibleSet = new Set<string>();
  private clickedSet = new Set<string>();
  private counters = new Map<string, DeliveryCounters>();
  private seq = 0;

  addCreative(c: Creative): void {
    if (!(c.weight > 0)) throw new Error('weight deve ser > 0');
    this.creatives.push(c);
  }
  setCreative(id: string, patch: Partial<Creative>): void {
    const c = this.creatives.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  }
  private counter(creativeId: string): DeliveryCounters {
    let c = this.counters.get(creativeId);
    if (!c) { c = { served: 0, visible: 0, clicks: 0, ignoredBotOrInternal: 0, refreshSuppressed: 0 }; this.counters.set(creativeId, c); }
    return c;
  }
  eligible(positionId: string, today: string): Creative[] {
    return this.creatives.filter((c) => c.positionId === positionId && c.approved && c.campaignActive && c.startDate <= today && today <= c.endDate);
  }

  serve(req: ServeRequest): ServeResult {
    const elig = this.eligible(req.positionId, req.today);
    if (req.isBot || req.isInternal) {
      // Serve o anúncio normalmente mas não conta como entrega faturável.
      const pick = this.pick(elig, req.positionId, false);
      if (pick) this.counter(pick.id).ignoredBotOrInternal++;
      return { kind: 'ignored', creativeId: pick?.id ?? null, impressionId: null, counted: false, reason: req.isBot ? 'bot' : 'interno' };
    }
    const key = `${req.pageViewId}|${req.positionId}`;
    const existing = this.views.get(key);
    if (existing) { // auto-refresh/reuso da mesma visualização de página: não infla
      const cid = this.impressionCreative.get(existing)!;
      this.counter(cid).refreshSuppressed++;
      return { kind: 'creative', creativeId: cid, impressionId: existing, counted: false, reason: 'refresh' };
    }
    const pick = this.pick(elig, req.positionId, true);
    if (!pick) return { kind: 'house', creativeId: null, impressionId: null, counted: false, reason: 'sem criativo elegível; house ad' };
    const imp = `imp-${++this.seq}`;
    this.views.set(key, imp);
    this.impressionCreative.set(imp, pick.id);
    this.counter(pick.id).served++;
    return { kind: 'creative', creativeId: pick.id, impressionId: imp, counted: true };
  }

  /** Smooth weighted round-robin (determinístico). */
  private pick(elig: Creative[], positionId: string, commit: boolean): Creative | undefined {
    if (!elig.length) return undefined;
    const total = elig.reduce((s, c) => s + c.weight, 0);
    let best: Creative | undefined; let bestCredit = -Infinity;
    const next = new Map<string, number>();
    for (const c of elig) {
      const cur = (this.credit.get(`${positionId}|${c.id}`) ?? 0) + c.weight;
      next.set(c.id, cur);
      if (cur > bestCredit) { bestCredit = cur; best = c; }
    }
    if (commit && best) {
      for (const [id, v] of next) this.credit.set(`${positionId}|${id}`, id === best.id ? v - total : v);
    }
    return best;
  }

  /** Impressão visível: reportada pelo cliente, só vale uma vez por impressão servida. */
  recordVisible(impressionId: string): boolean {
    const cid = this.impressionCreative.get(impressionId);
    if (!cid || this.visibleSet.has(impressionId)) return false;
    this.visibleSet.add(impressionId); this.counter(cid).visible++; return true;
  }
  /** Clique válido: precisa de impressão servida real e é contado uma vez por impressão. */
  recordClick(impressionId: string): boolean {
    const cid = this.impressionCreative.get(impressionId);
    if (!cid || this.clickedSet.has(impressionId)) return false;
    this.clickedSet.add(impressionId); this.counter(cid).clicks++; return true;
  }
  delivery(creativeId: string): DeliveryCounters & { ctr: number | null } {
    const c = { ...this.counter(creativeId) };
    return { ...c, ctr: c.served > 0 ? c.clicks / c.served : null }; // null = sem entrega, nunca 0% falso
  }
  campaignDelivery(campaignId: string): DeliveryCounters & { ctr: number | null } {
    const sum: DeliveryCounters = { served: 0, visible: 0, clicks: 0, ignoredBotOrInternal: 0, refreshSuppressed: 0 };
    for (const cr of this.creatives.filter((x) => x.campaignId === campaignId)) {
      const c = this.counter(cr.id);
      for (const k of Object.keys(sum) as (keyof DeliveryCounters)[]) sum[k] += c[k];
    }
    return { ...sum, ctr: sum.served > 0 ? sum.clicks / sum.served : null };
  }
}
