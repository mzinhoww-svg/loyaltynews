// Livro de impressões do ad server: dedupe de auto-refresh (uma impressão por visualização+posição) e de visível/clique
// (uma vez por impressão). Antes vivia em mapas privados do AdServer, na memória do processo.
//
// MÚLTIPLAS INSTÂNCIAS: o livro é uma classe própria, injetável no AdServer. O Backend mantém a verdade em armazenamento
// compartilhado (ver docs/dedupe-persistido.md) e usa este livro como cache de trabalho por requisição:
//   1. `preload(entries)` com as entradas já existentes das chaves da requisição (lidas do Redis/tabela);
//   2. `ads.serve(...)`/`recordVisible`/`recordClick` rodam sem I/O;
//   3. `drainChanges()` devolve o que nasceu ou mudou para gravar de forma atômica (SET NX / INSERT ... ON CONFLICT).
// Ids de impressão precisam ser únicos entre instâncias: injete `newId` (ex.: crypto.randomUUID); o padrão `imp-N` é só local.
import { SNAPSHOT_VERSION, assertSnapshot, assertUnique, clone, maxSeq } from './snapshot';

export interface LedgerEntry {
  impressionId: string;
  /** `${pageViewId}|${positionId}` */
  key: string;
  creativeId: string;
  /** epoch ms de criação; usado só para expirar (TTL). */
  at: number;
  visible: boolean;
  clicked: boolean;
}
export interface LedgerSnapshot { version: typeof SNAPSHOT_VERSION; seq: number; entries: LedgerEntry[] }

export const viewKey = (pageViewId: string, positionId: string): string => `${pageViewId}|${positionId}`;

export class ImpressionLedger {
  private byKey = new Map<string, LedgerEntry>();
  private byId = new Map<string, LedgerEntry>();
  private dirty = new Set<string>();
  private seq = 0;
  private newId: () => string;
  private clock: () => number;

  constructor(opts: { newId?: () => string; now?: () => number } = {}) {
    this.newId = opts.newId ?? (() => `imp-${++this.seq}`);
    this.clock = opts.now ?? (() => Date.now());
  }

  get size(): number { return this.byId.size; }
  byViewKey(key: string): LedgerEntry | undefined { return this.byKey.get(key); }
  byImpressionId(id: string): LedgerEntry | undefined { return this.byId.get(id); }

  /** Registra a primeira impressão da visualização. Chamar só se `byViewKey(key)` for indefinido. */
  register(key: string, creativeId: string): LedgerEntry {
    const e: LedgerEntry = { impressionId: this.newId(), key, creativeId, at: this.clock(), visible: false, clicked: false };
    this.byKey.set(key, e); this.byId.set(e.impressionId, e); this.dirty.add(e.impressionId);
    return e;
  }
  /** Visível: vale uma vez por impressão. Retorna false se já contada ou desconhecida. */
  markVisible(impressionId: string): boolean {
    const e = this.byId.get(impressionId);
    if (!e || e.visible) return false;
    e.visible = true; this.dirty.add(impressionId); return true;
  }
  markClicked(impressionId: string): boolean {
    const e = this.byId.get(impressionId);
    if (!e || e.clicked) return false;
    e.clicked = true; this.dirty.add(impressionId); return true;
  }

  /** Carrega entradas já persistidas (não as marca como alteradas). Entrada existente com mesma chave é substituída. */
  preload(entries: readonly LedgerEntry[]): void {
    for (const raw of entries) {
      const e = clone(raw);
      const old = this.byKey.get(e.key);
      if (old) this.byId.delete(old.impressionId);
      this.byKey.set(e.key, e); this.byId.set(e.impressionId, e);
    }
    this.seq = Math.max(this.seq, maxSeq(entries.map((e) => e.impressionId)));
  }
  /** Entradas criadas/alteradas desde a última drenagem; zera a marca. Grave-as no armazenamento compartilhado. */
  drainChanges(): LedgerEntry[] {
    const out = [...this.dirty].map((id) => clone(this.byId.get(id)!)).filter(Boolean);
    this.dirty.clear();
    return out;
  }
  /** Remove entradas criadas antes de `beforeMs` (TTL local). Retorna quantas saíram. */
  evict(beforeMs: number): number {
    let n = 0;
    for (const [id, e] of this.byId) {
      if (e.at < beforeMs) { this.byId.delete(id); this.byKey.delete(e.key); this.dirty.delete(id); n++; }
    }
    return n;
  }
  clear(): void { this.byKey.clear(); this.byId.clear(); this.dirty.clear(); }

  snapshot(): LedgerSnapshot { return { version: SNAPSHOT_VERSION, seq: this.seq, entries: clone([...this.byId.values()]) }; }
  load(s: LedgerSnapshot): void {
    assertSnapshot(s, 'ImpressionLedger', ['entries']);
    assertUnique(s.entries.map((e) => e.impressionId), 'ImpressionLedger');
    this.clear();
    this.preload(s.entries);
    this.seq = Math.max(this.seq, s.seq);
  }
}
