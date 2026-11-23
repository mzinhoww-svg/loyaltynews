// Criativo publicitário "real": o que o portal pode exibir. Regra do PM: só criativo real aparece; sem criativo, a posição fica oculta.
// "Real" = aprovado, em campanha ativa, no período, E com arquivo, texto alternativo, anunciante e destino https válidos para a posição.
// Este módulo é puro (sem I/O): valida, monta a visão pública (sem campo interno) e resolve o destino do clique a partir do criativo
// (nunca de uma URL vinda do cliente, para não haver redirecionamento aberto).
import type { BannerPosition } from './inventory';
import { POSITIONS } from './inventory';
import type { Creative } from './rotation';

/** Tipos aceitos hoje. HTML5 só depois da análise de sandbox (Blueprint §4); por isso não entra. */
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif'] as const;
export type AdMime = (typeof ALLOWED_MIME)[number];
const MIME_TO_TYPE: Record<AdMime, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/gif': 'GIF' };

export interface CreativeAsset {
  /** Chave no Blob S3 (nunca URL externa de anunciante). */
  key: string;
  mime: AdMime;
  width: number; height: number;
  sizeKB: number;
  /** sha256 do arquivo, para cache e verificação; opcional. */
  sha256?: string;
}

export type CreativeIssueCode =
  | 'POSITION_UNKNOWN' | 'POSITION_NOT_CONFIGURED' | 'NO_ASSET' | 'BAD_MIME' | 'BAD_DIMENSIONS' | 'TOO_HEAVY'
  | 'NO_ALT' | 'NO_ADVERTISER' | 'NO_DESTINATION' | 'BAD_DESTINATION';
export interface CreativeIssue { code: CreativeIssueCode; message: string }

/** Cada problema é uma linha: o Studio mostra tudo o que falta de uma vez. Lista vazia = criativo válido. */
export function validateCreative(c: Creative, positions: readonly BannerPosition[] = POSITIONS): CreativeIssue[] {
  const out: CreativeIssue[] = [];
  const p = positions.find((x) => x.id === c.positionId);
  if (!p) return [{ code: 'POSITION_UNKNOWN', message: `Posição ${c.positionId} desconhecida.` }];
  if (p.desktop === null || p.slotLimit === null) out.push({ code: 'POSITION_NOT_CONFIGURED', message: `${p.id} ainda não tem dimensões e limite configurados.` });

  const a = c.asset;
  if (!a || !a.key) out.push({ code: 'NO_ASSET', message: 'Sem arquivo do criativo.' });
  else {
    if (!(ALLOWED_MIME as readonly string[]).includes(a.mime)) out.push({ code: 'BAD_MIME', message: `Tipo ${a.mime} não aceito (JPG, PNG ou GIF).` });
    if (p.desktop !== null) {
      const [w, h] = p.desktop.split('x').map(Number);
      if (a.width !== w || a.height !== h) out.push({ code: 'BAD_DIMENSIONS', message: `Dimensão ${a.width}x${a.height}; ${p.id} exige ${p.desktop}.` });
    }
    if (p.maxWeightKB !== null && !(a.sizeKB > 0 && a.sizeKB <= p.maxWeightKB)) out.push({ code: 'TOO_HEAVY', message: `Peso ${a.sizeKB} KB; máximo de ${p.id}: ${p.maxWeightKB} KB.` });
    if (!p.allowedTypes.includes(MIME_TO_TYPE[a.mime] ?? '')) out.push({ code: 'BAD_MIME', message: `${MIME_TO_TYPE[a.mime] ?? a.mime} não permitido em ${p.id}.` });
  }
  const alt = (c.altText ?? '').trim();
  if (alt.length < 1 || alt.length > 200) out.push({ code: 'NO_ALT', message: 'Texto alternativo obrigatório (1 a 200 caracteres).' });
  const adv = (c.advertiserName ?? '').trim();
  if (adv.length < 1 || adv.length > 80) out.push({ code: 'NO_ADVERTISER', message: 'Nome do anunciante obrigatório (1 a 80 caracteres).' });
  if (!c.destinationUrl) out.push({ code: 'NO_DESTINATION', message: 'Sem URL de destino.' });
  else if (!isSafeDestination(c.destinationUrl)) out.push({ code: 'BAD_DESTINATION', message: 'Destino precisa ser https, sem credenciais embutidas.' });
  return out;
}

/** Destino seguro: https, host presente, sem usuário/senha, tamanho razoável. */
export function isSafeDestination(raw: string): boolean {
  if (raw.length > 2000) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === 'https:' && u.hostname.length > 0 && u.username === '' && u.password === '';
}

export const isRealCreative = (c: Creative, positions: readonly BannerPosition[] = POSITIONS): boolean => validateCreative(c, positions).length === 0;

// ---------- visão pública ----------
export interface AdUrls {
  /** URL pública da imagem do criativo (o Backend entrega do Blob com cabeçalhos defensivos). */
  image(creativeId: string, asset: CreativeAsset): string;
  /** URL de clique. `ref` é o id da impressão (conta o clique) ou `c:{creativeId}` (leva ao destino sem contar). */
  click(ref: string): string;
}
export const DEFAULT_AD_URLS: AdUrls = {
  image: (id, a) => `/api/commercial/ads/creative-image?id=${encodeURIComponent(id)}${a.sha256 ? `&v=${a.sha256.slice(0, 8)}` : ''}`,
  click: (ref) => `/api/commercial/ads/click?ref=${encodeURIComponent(ref)}`,
};

/** O que o portal recebe. Nenhum id de campanha, conta, peso, status ou chave de arquivo. */
export interface PublicAd {
  positionId: string;
  creativeId: string;
  /** Sempre "Publicidade": conteúdo pago é rotulado (F-074). */
  label: 'Publicidade';
  advertiser: string;
  imageSrc: string;
  alt: string;
  width: number; height: number;
  /** Passa pelo servidor para contar o clique e então redireciona ao destino do criativo. */
  href: string;
  /** `true` quando a impressão foi contada (há impressionId); o portal pode reportar visível e clique. */
  impressionId: string | null;
}

export function toPublicAd(c: Creative, impressionId: string | null, urls: AdUrls = DEFAULT_AD_URLS, positions: readonly BannerPosition[] = POSITIONS): PublicAd | null {
  if (!isRealCreative(c, positions) || !c.asset) return null;
  return {
    positionId: c.positionId, creativeId: c.id, label: 'Publicidade', advertiser: c.advertiserName!.trim(),
    imageSrc: urls.image(c.id, c.asset), alt: c.altText!.trim(), width: c.asset.width, height: c.asset.height,
    href: urls.click(impressionId ?? `c:${c.id}`), impressionId,
  };
}

/**
 * Resolve o destino do clique. `ref` = id de impressão (via ledger → criativo) ou `c:{creativeId}`. O destino sai SEMPRE do criativo
 * cadastrado; entrada desconhecida ou criativo que deixou de ser real => null (o Backend responde 404, nunca redireciona às cegas).
 */
export function resolveClickDestination(
  ref: string,
  creatives: readonly Creative[],
  creativeOfImpression: (impressionId: string) => string | undefined,
  positions: readonly BannerPosition[] = POSITIONS,
): { creativeId: string; destination: string; impressionId: string | null } | null {
  const viaCreative = ref.startsWith('c:');
  const creativeId = viaCreative ? ref.slice(2) : creativeOfImpression(ref);
  if (!creativeId) return null;
  const c = creatives.find((x) => x.id === creativeId);
  if (!c || !c.approved || !isRealCreative(c, positions) || !c.destinationUrl) return null;
  return { creativeId, destination: c.destinationUrl, impressionId: viaCreative ? null : ref };
}

// ---------- plano das posições (sem contar nada) ----------
export interface AdPlanSlot { positionId: string; available: boolean; width: number | null; height: number | null }
/**
 * Para cada posição: há algum criativo real elegível hoje? Serve para o portal decidir, ao renderizar, se reserva o espaço
 * (evita deslocamento de layout) ou oculta a posição. NÃO registra impressão. Posição sem criativo real => `available:false`.
 */
export function adPlan(creatives: readonly Creative[], today: string, positionIds: readonly string[] = POSITIONS.map((p) => p.id), positions: readonly BannerPosition[] = POSITIONS): AdPlanSlot[] {
  return positionIds.map((id) => {
    const p = positions.find((x) => x.id === id);
    const live = creatives.filter((c) => c.positionId === id && c.approved && c.campaignActive && c.startDate <= today && today <= c.endDate && isRealCreative(c, positions));
    const dims = p?.desktop ? p.desktop.split('x').map(Number) : null;
    return live.length && dims ? { positionId: id, available: true, width: dims[0]!, height: dims[1]! } : { positionId: id, available: false, width: null, height: null };
  });
}
