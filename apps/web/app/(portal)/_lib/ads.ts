import type { AdSlotId } from './types';

/**
 * Publicidade no modo `api` (contrato do @ln/commercial: ft/commercial 2b26b64).
 *  - O SERVIDOR só pergunta o PLANO das posições (GET /api/commercial/ads/plan): posição sem criativo real fica oculta, sem espaço reservado.
 *    O servidor NUNCA chama `serve` (SSR/ISR contaria uma impressão por renderização e a página fica em cache).
 *  - O CLIENTE, depois de hidratar, chama POST /api/commercial/ads/serve com UM pageViewId por carregamento de página e só desenha com `ad`.
 *  - Visível (≥ 50 % da área por ≥ 1 s) vira POST /api/commercial/ads/event uma única vez, só com impressionId.
 * Este módulo é puro (sem `process`, sem `next/*`): serve ao servidor e ao componente cliente.
 */

export type AdPositionId = 'TOP' | 'SIDEBAR_1' | 'SIDEBAR_2' | 'SIDEBAR_3' | 'FOOTER' | 'HOME_BETWEEN' | 'ARTICLE_INLINE';

/** Mapa de posições do portal. `entre-secoes` e `in-article` ainda não têm dimensão/limite no inventário: nunca ficam disponíveis. */
export const AD_POSITION_OF: Record<AdSlotId, AdPositionId> = {
  topo: 'TOP',
  'sidebar-1': 'SIDEBAR_1',
  'sidebar-2': 'SIDEBAR_2',
  'sidebar-3': 'SIDEBAR_3',
  rodape: 'FOOTER',
  'entre-secoes': 'HOME_BETWEEN',
  'in-article': 'ARTICLE_INLINE',
};
export const AD_PLAN_POSITIONS: readonly AdPositionId[] = ['TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER', 'HOME_BETWEEN', 'ARTICLE_INLINE'];

export interface AdPlanSlot {
  positionId: AdPositionId;
  /** Dimensão do desktop (ou a primeira do mobile, quando a posição só tem criativo mobile). */
  width: number;
  height: number;
  /** A posição tem criativo elegível no desktop. `false` = só no mobile: no desktop não aparece. */
  desktop: boolean;
  /** Formatos mobile do plano (`mobile` aditivo do GET /ads/plan). `null` = API antiga, sem o campo (o mobile tenta e confere ao receber). `[]` = nenhum. */
  mobile: readonly { width: number; height: number }[] | null;
}
/** Posições disponíveis (com criativo real elegível hoje), por id. Vazio = nada a mostrar. */
export type AdPlan = ReadonlyMap<AdPositionId, AdPlanSlot>;

/** O que o portal recebe do servidor de anúncios (visão pública do criativo). */
export interface PublicAd {
  positionId: string;
  label: 'Publicidade';
  advertiser: string;
  imageSrc: string;
  alt: string;
  width: number;
  height: number;
  href: string;
  /** `null` = a impressão não foi contada: não há evento de visibilidade a enviar. */
  impressionId: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const dim = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 4000;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Caminho do próprio portal (`/…`, nunca `//host`) ou URL http(s), normalizada pelo parser; qualquer outra coisa (javascript:, data:) é recusada. */
export function safeAdUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2000) return null;
  if (v.startsWith('//') || v.includes('\\')) return null; // //host e barra invertida: nunca
  try {
    const u = new URL(v, 'http://portal.invalid');
    if (u.origin === 'http://portal.invalid') return /^\/(?!\/)/.test(v) && !/[\\<>"]/.test(v) ? `${u.pathname}${u.search}` : null;
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Resposta de GET /api/commercial/ads/plan. Formato inesperado = nenhuma posição disponível (nunca lança). */
export function parseAdPlan(json: unknown): AdPlan {
  const out = new Map<AdPositionId, AdPlanSlot>();
  if (!isObj(json) || !Array.isArray(json.slots)) return out;
  for (const s of json.slots.slice(0, 20)) {
    if (!isObj(s)) continue;
    const id = AD_PLAN_POSITIONS.find((p) => p === s.positionId);
    if (!id) continue;
    const mobile = Array.isArray(s.mobile)
      ? s.mobile.slice(0, 10).flatMap((m) => (isObj(m) && dim(m.width) && dim(m.height) ? [{ width: m.width, height: m.height }] : []))
      : null;
    const desktop = s.available === true && dim(s.width) && dim(s.height);
    if (desktop) out.set(id, { positionId: id, width: s.width as number, height: s.height as number, desktop: true, mobile });
    else if (mobile && mobile.length > 0) out.set(id, { positionId: id, width: mobile[0]!.width, height: mobile[0]!.height, desktop: false, mobile });
  }
  return out;
}

/** Resposta de POST /api/commercial/ads/serve. Só devolve anúncio com TODOS os campos públicos válidos; sem `ad` (house/erro) = null: a posição recolhe. */
export function parseServeAd(json: unknown): PublicAd | null {
  if (!isObj(json) || json.kind !== 'creative' || !isObj(json.ad)) return null;
  const a = json.ad;
  const imageSrc = safeAdUrl(a.imageSrc);
  const href = safeAdUrl(a.href);
  if (!imageSrc || !href || !text(a.advertiser, 120) || !text(a.alt, 300) || !dim(a.width) || !dim(a.height) || !text(a.positionId, 40)) return null;
  const impressionId = typeof a.impressionId === 'string' && a.impressionId.length > 0 && a.impressionId.length <= 128 ? a.impressionId : null;
  return { positionId: a.positionId, label: 'Publicidade', advertiser: a.advertiser.trim(), imageSrc, alt: a.alt.trim(), width: a.width, height: a.height, href, impressionId };
}

/** Plano buscado no servidor: uma leitura cacheável por 60 s; qualquer falha = plano vazio (nada aparece, nada quebra). */
export async function fetchAdPlan(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<AdPlan> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/commercial/ads/plan?positions=${AD_PLAN_POSITIONS.join(',')}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
      next: { revalidate: 60 },
    } as RequestInit);
    if (!res.ok) return new Map();
    return parseAdPlan(await res.json());
  } catch {
    return new Map();
  }
}

/** Identificador de visualização de página: um por carregamento (e por caminho, na navegação interna), igual para todas as posições. */
export function newPageViewId(rand: () => string = defaultRandom): string {
  return rand();
}
function defaultRandom(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') || String(Date.now());
}

export interface VisibleTrackerEnv {
  /** Cria o observador (IntersectionObserver) com limiar de 50 %. */
  observe(el: Element, onRatio: (ratio: number) => void): () => void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** `document.visibilityState === 'visible'`. */
  pageVisible(): boolean;
}

/**
 * Visível = ≥ 50 % da área por ≥ 1 s contínuo, com a aba visível. Dispara `onVisible` UMA vez. Devolve a função que cancela tudo.
 */
export function trackVisible(el: Element, onVisible: () => void, env: VisibleTrackerEnv, opts: { ratio?: number; ms?: number } = {}): () => void {
  const ratio = opts.ratio ?? 0.5;
  const ms = opts.ms ?? 1000;
  let timer: unknown = null;
  let done = false;
  const clear = () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  };
  const stop = env.observe(el, (r) => {
    if (done) return;
    if (r >= ratio && timer === null) {
      timer = env.setTimeout(() => {
        timer = null;
        if (done || !env.pageVisible()) return;
        done = true;
        stop();
        onVisible();
      }, ms);
    } else if (r < ratio) clear();
  });
  return () => {
    done = true;
    clear();
    stop();
  };
}
