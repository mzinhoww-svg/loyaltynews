// Rotação ponderada de anúncios com contagem de impressões servidas/visíveis e cliques válidos.
// Regras (Blueprint v2.0 §4): sem inflar impressões por auto-refresh; excluir bots e tráfego interno; fallback house ad.
import { ImpressionLedger, viewKey, type LedgerSnapshot } from './ledger';
import { SNAPSHOT_VERSION, assertSnapshot, assertUnique, clone } from './snapshot';
import { DeliveryAudit, type AuditSnapshot } from './audit';
import { DEFAULT_AD_URLS, isRealCreative, toPublicAd, type AdUrls, type CreativeAsset, type PublicAd } from './creative';
import { POSITIONS, type BannerPosition } from './inventory';

export interface Creative {
  id: string; campaignId: string; positionId: string;
  /** Peso relativo (>0). Pesos iguais => share of voice igual (ex.: 25% no TOP com 4 anunciantes). */
  weight: number;
  startDate: string; endDate: string; // YYYY-MM-DD inclusivos
  /** Somente criativos aprovados e de campanha ativa são elegíveis. */
  approved: boolean; campaignActive: boolean;
  label?: 'publicidade'; // publieditoriais sempre rotulados
  /** Arquivo, texto alternativo, anunciante e destino: sem eles o criativo não é "real" e não é elegível (ver creative.ts). */
  asset?: CreativeAsset;
  altText?: string;
  advertiserName?: string;
  destinationUrl?: string;
}
export interface ServeRequest {
  positionId: string; today: string; pageViewId: string;
  isBot?: boolean; isInternal?: boolean;
  /** Instante da requisição (epoch ms). Padrão: relógio do ledger. Usado para a janela de suspensão por perda de dedupe. */
  nowMs?: number;
}
export interface ServeResult {
  kind: 'creative' | 'house' | 'ignored'; creativeId: string | null; impressionId: string | null; counted: boolean; reason?: string;
  /** Visão pública do criativo servido (sem campos internos). Ausente em house; sem ela a posição fica oculta no portal. */
  ad?: PublicAd;
}

export interface DeliveryCounters { served: number; visible: number; clicks: number; ignoredBotOrInternal: number; refreshSuppressed: number }
const ZERO = (): DeliveryCounters => ({ served: 0, visible: 0, clicks: 0, ignoredBotOrInternal: 0, refreshSuppressed: 0 });

export interface AdServerSnapshot {
  version: typeof SNAPSHOT_VERSION;
  creatives: Creative[];
  counters: Record<string, DeliveryCounters>;
  /** Estado da rotação ponderada (crédito por `posição|criativo`). Aproximação por instância é aceitável. */
  credit: Record<string, number>;
  /** Livro de impressões (dedupe). Em produção vem do armazenamento compartilhado, não do snapshot do ad server. */
  ledger: LedgerSnapshot;
  /** Lacunas de auditabilidade (perda de dedupe). Opcional para ler snapshots antigos. */
  audit?: AuditSnapshot;
}

/** Diferença `after - before` por criativo; só devolve criativos com alguma variação. Base do UPSERT em ad_delivery_daily. */
export function diffCounters(before: Readonly<Record<string, DeliveryCounters>>, after: Readonly<Record<string, DeliveryCounters>>): Record<string, DeliveryCounters> {
  const out: Record<string, DeliveryCounters> = {};
  for (const [id, a] of Object.entries(after)) {
    const b = before[id] ?? ZERO();
    const d: DeliveryCounters = {
      served: a.served - b.served, visible: a.visible - b.visible, clicks: a.clicks - b.clicks,
      ignoredBotOrInternal: a.ignoredBotOrInternal - b.ignoredBotOrInternal, refreshSuppressed: a.refreshSuppressed - b.refreshSuppressed,
    };
    if (Object.values(d).some((v) => v !== 0)) out[id] = d;
  }
  return out;
}

export class AdServer {
  private creatives: Creative[] = [];
  private credit = new Map<string, number>(); // smooth weighted round-robin por posição
  private counters = new Map<string, DeliveryCounters>();
  /** Dedupe de impressões. Injetável: instâncias compartilham a verdade via armazenamento externo (ver ledger.ts). */
  readonly ledger: ImpressionLedger;

  /** Lacunas de auditabilidade: perda/regressão do armazenamento de dedupe suspende a contagem (ver audit.ts). */
  readonly audit: DeliveryAudit;

  private positions: readonly BannerPosition[];
  private urls: AdUrls;

  constructor(ledger: ImpressionLedger = new ImpressionLedger(), audit: DeliveryAudit = new DeliveryAudit(), opts: { positions?: readonly BannerPosition[]; urls?: AdUrls } = {}) {
    this.ledger = ledger; this.audit = audit; this.positions = opts.positions ?? POSITIONS; this.urls = opts.urls ?? DEFAULT_AD_URLS;
  }

  /** Visão pública de um criativo (para quem monta a resposta por fora, ex.: vencedor da corrida no Redis). Null se não for criativo real. */
  publicAdFor(creativeId: string, impressionId: string | null): PublicAd | null {
    const c = this.creatives.find((x) => x.id === creativeId);
    return c ? toPublicAd(c, impressionId, this.urls, this.positions) : null;
  }

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
    if (!c) { c = ZERO(); this.counters.set(creativeId, c); }
    return c;
  }
  creativesOf(campaignId: string): readonly Creative[] { return this.creatives.filter((c) => c.campaignId === campaignId); }
  listCreatives(): readonly Creative[] { return this.creatives; }
  eligible(positionId: string, today: string): Creative[] {
    return this.creatives.filter((c) => c.positionId === positionId && c.approved && c.campaignActive && c.startDate <= today && today <= c.endDate && isRealCreative(c, this.positions));
  }

  serve(req: ServeRequest): ServeResult {
    const elig = this.eligible(req.positionId, req.today);
    if (req.isBot || req.isInternal) {
      // Serve o anúncio normalmente mas não conta como entrega faturável.
      const pick = this.pick(elig, req.positionId, false);
      if (pick) this.counter(pick.id).ignoredBotOrInternal++;
      return { kind: 'ignored', creativeId: pick?.id ?? null, impressionId: null, counted: false, reason: req.isBot ? 'bot' : 'interno', ...this.adOf(pick, null) };
    }
    const now = req.nowMs ?? this.ledger.now();
    if (this.audit.servingSuspended(now)) {
      // Dedupe não confiável: serve o criativo (rotação normal) mas NÃO conta; a lacuna registra quantas ficaram sem contagem.
      const pick = this.pick(elig, req.positionId, true);
      if (!pick) return { kind: 'house', creativeId: null, impressionId: null, counted: false, reason: 'sem criativo elegível; house ad' };
      this.audit.noteUncountedServe(now);
      return { kind: 'creative', creativeId: pick.id, impressionId: null, counted: false, reason: 'dedupe_suspenso', ...this.adOf(pick, null) };
    }
    const key = viewKey(req.pageViewId, req.positionId);
    const existing = this.ledger.byViewKey(key);
    if (existing) { // auto-refresh/reuso da mesma visualização de página: não infla
      this.counter(existing.creativeId).refreshSuppressed++;
      return { kind: 'creative', creativeId: existing.creativeId, impressionId: existing.impressionId, counted: false, reason: 'refresh', ...this.adOf(this.creatives.find((x) => x.id === existing.creativeId), existing.impressionId) };
    }
    const pick = this.pick(elig, req.positionId, true);
    if (!pick) return { kind: 'house', creativeId: null, impressionId: null, counted: false, reason: 'sem criativo elegível; house ad' };
    const e = this.ledger.register(key, pick.id);
    this.counter(pick.id).served++;
    return { kind: 'creative', creativeId: pick.id, impressionId: e.impressionId, counted: true, ...this.adOf(pick, e.impressionId) };
  }

  private adOf(c: Creative | undefined, impressionId: string | null): { ad?: PublicAd } {
    const ad = c ? toPublicAd(c, impressionId, this.urls, this.positions) : null;
    return ad ? { ad } : {};
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
  recordVisible(impressionId: string, nowMs: number = this.ledger.now()): boolean {
    if (this.audit.eventsSuspended(nowMs)) { this.audit.noteIgnoredEvent(nowMs); return false; }
    const e = this.ledger.byImpressionId(impressionId);
    if (!e || !this.ledger.markVisible(impressionId)) return false;
    this.counter(e.creativeId).visible++; return true;
  }
  /** Clique válido: precisa de impressão servida real e é contado uma vez por impressão. */
  recordClick(impressionId: string, nowMs: number = this.ledger.now()): boolean {
    if (this.audit.eventsSuspended(nowMs)) { this.audit.noteIgnoredEvent(nowMs); return false; }
    const e = this.ledger.byImpressionId(impressionId);
    if (!e || !this.ledger.markClicked(impressionId)) return false;
    this.counter(e.creativeId).clicks++; return true;
  }
  delivery(creativeId: string): DeliveryCounters & { ctr: number | null } {
    const c = { ...this.counter(creativeId) };
    return { ...c, ctr: c.served > 0 ? c.clicks / c.served : null }; // null = sem entrega, nunca 0% falso
  }
  campaignDelivery(campaignId: string): DeliveryCounters & { ctr: number | null } {
    const sum = ZERO();
    for (const cr of this.creatives.filter((x) => x.campaignId === campaignId)) {
      const c = this.counter(cr.id);
      for (const k of Object.keys(sum) as (keyof DeliveryCounters)[]) sum[k] += c[k];
    }
    return { ...sum, ctr: sum.served > 0 ? sum.clicks / sum.served : null };
  }

  // ---------- hidratação e persistência ----------
  /** Contadores acumulados de todos os criativos (cópia). Compare com `loadCounters` para obter o delta do ciclo. */
  countersSnapshot(): Record<string, DeliveryCounters> { return clone(Object.fromEntries(this.counters)); }
  /** Substitui os criativos (ex.: lidos de ad_creatives). Peso inválido ou ids repetidos são recusados. */
  loadCreatives(creatives: readonly Creative[]): void {
    assertUnique(creatives.map((c) => c.id), 'AdServer.creatives');
    for (const c of creatives) if (!(c.weight > 0)) throw new Error(`Criativo ${c.id}: weight deve ser > 0`);
    this.creatives = clone([...creatives]);
  }
  /** Substitui os contadores (ex.: somatório de ad_delivery_daily). */
  loadCounters(counters: Readonly<Record<string, DeliveryCounters>>): void {
    this.counters = new Map(Object.entries(clone(counters)));
  }
  snapshot(): AdServerSnapshot {
    return { version: SNAPSHOT_VERSION, creatives: clone(this.creatives), counters: this.countersSnapshot(), credit: Object.fromEntries(this.credit), ledger: this.ledger.snapshot(), audit: this.audit.snapshot() };
  }
  /** Restaura tudo, inclusive o livro de impressões do próprio snapshot. */
  load(s: AdServerSnapshot): void {
    assertSnapshot(s, 'AdServer', ['creatives']);
    this.loadCreatives(s.creatives);
    this.loadCounters(s.counters ?? {});
    this.credit = new Map(Object.entries(s.credit ?? {}));
    if (s.ledger) this.ledger.load(s.ledger);
    if (s.audit) this.audit.load(s.audit);
  }
}
