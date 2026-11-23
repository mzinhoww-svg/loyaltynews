import type { CollectEvent } from './event';

// Lado do navegador (entrada client-safe `@ln/analytics/client`): só monta o corpo mínimo da coleta e decide se pode enviar.
// NÃO usa cookie, localStorage, sessionStorage, fingerprint nem biblioteca de terceiros, e NÃO envia nada: o envio
// (`navigator.sendBeacon('/api/analytics/collect', corpo)`) fica com o Frontend, atrás da flag, depois de `shouldSend`.

export interface PageContext {
  /** `location.pathname` (a query e o hash não são lidos). */
  pathname: string;
  /** `document.referrer` bruto (o servidor reduz a uma categoria). */
  referrer?: string;
  /** `window.innerWidth`. */
  innerWidth?: number;
}

export function buildCollectPayload(ctx: PageContext): CollectEvent {
  const ev: CollectEvent = { t: 'pageview', path: ctx.pathname.split(/[?#]/, 1)[0] || '/' };
  if (ctx.referrer) ev.ref = ctx.referrer;
  if (typeof ctx.innerWidth === 'number' && Number.isFinite(ctx.innerWidth) && ctx.innerWidth > 0) ev.w = Math.round(ctx.innerWidth);
  return ev;
}

/** Não envia se o navegador sinaliza GPC ou DNT. A decisão final é do servidor (que repete a checagem pelos cabeçalhos). */
export function shouldSend(signals: { gpc?: boolean; dnt?: boolean }): boolean {
  return signals.gpc !== true && signals.dnt !== true;
}
