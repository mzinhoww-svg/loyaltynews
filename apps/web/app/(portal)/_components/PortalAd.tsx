'use client';

import { AdSlot as DsAdSlot, type AdPosition } from '@ln/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { newPageViewId, parseServeAd, trackVisible, type PublicAd } from '../_lib/ads';

/**
 * Anúncio de uma posição que o plano marcou como disponível. Reserva o espaço no servidor (sem deslocamento de layout) e, depois de
 * hidratar, pede o criativo. Sem `ad` na resposta (house, erro, flag desligada) a posição RECOLHE: nada de "espaço reservado" ao leitor.
 */

/** Um pageViewId por carregamento de página (o mesmo em todas as posições); muda quando o caminho muda (navegação interna). */
let currentView: { path: string; id: string } | null = null;
const pageViewFor = (path: string): string => {
  if (!currentView || currentView.path !== path) currentView = { path, id: newPageViewId() };
  return currentView.id;
};

/** Uma chamada por (pageViewId, posição): o modo estrito do React em desenvolvimento não duplica a impressão. */
const inflight = new Map<string, Promise<PublicAd | null>>();
function serve(positionId: string, pageViewId: string, mobile: boolean): Promise<PublicAd | null> {
  const key = `${pageViewId}:${positionId}:${mobile ? 'm' : 'd'}`;
  let p = inflight.get(key);
  if (!p) {
    p = fetch('/api/commercial/ads/serve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(mobile ? { positionId, pageViewId, device: 'mobile' } : { positionId, pageViewId }),
      credentials: 'omit',
      cache: 'no-store',
    })
      .then(async (r) => (r.ok ? parseServeAd(await r.json()) : null))
      .catch(() => null);
    inflight.set(key, p);
    if (inflight.size > 50) inflight.delete(inflight.keys().next().value as string);
  }
  return p;
}

function reportVisible(impressionId: string): void {
  void fetch('/api/commercial/ads/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ impressionId, event: 'visible' }),
    credentials: 'omit',
    keepalive: true,
  }).catch(() => undefined);
}

/** Formatos de anúncio do mobile (inventário do @ln/commercial). No mobile só estes aparecem: nunca se estica um banner desktop. */
export const MOBILE_AD_FORMATS: readonly (readonly [number, number])[] = [[320, 100], [300, 250]];
export const isMobileAdFormat = (w: number, h: number): boolean => MOBILE_AD_FORMATS.some(([mw, mh]) => mw === w && mh === h);
const MOBILE_QUERY = '(max-width: 767px)';

export function PortalAd({ position, width, height }: { position: AdPosition; width: number; height: number }) {
  const path = usePathname() ?? '/';
  const [ad, setAd] = useState<PublicAd | null | undefined>(undefined); // undefined = carregando (espaço reservado); null = recolhe
  const box = useRef<HTMLDivElement>(null);

  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    let live = true;
    // Viewport lido uma vez por carregamento (uma chamada de serve por página): o formato mobile é pedido ao servidor e conferido ao chegar.
    const isMobile = window.matchMedia(MOBILE_QUERY).matches;
    setMobile(isMobile);
    void serve(position, pageViewFor(path), isMobile).then((a) => {
      if (!live) return;
      // No mobile, criativo que não for 320×100 ou 300×250 não é exibido (a posição recolhe, sem espaço reservado).
      setAd(a && isMobile && !isMobileAdFormat(a.width, a.height) ? null : a);
    });
    return () => {
      live = false;
    };
  }, [position, path]);

  // Visível: ≥ 50 % da área por ≥ 1 s, uma vez por anúncio exibido (só com impressionId).
  useEffect(() => {
    const id = ad?.impressionId;
    const el = box.current;
    if (!id || !el) return;
    return trackVisible(el, () => reportVisible(id), {
      observe(target, onRatio) {
        const io = new IntersectionObserver((entries) => entries.forEach((e) => onRatio(e.intersectionRatio)), { threshold: [0, 0.25, 0.5, 0.75, 1] });
        io.observe(target);
        return () => io.disconnect();
      },
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (t) => window.clearTimeout(t as number),
      pageVisible: () => document.visibilityState === 'visible',
    });
  }, [ad]);

  if (ad === null) return null;
  return (
    <div
      ref={box}
      className="pt-ad"
      data-testid="portal-ad"
      data-position={position}
      data-state={ad ? 'ad' : 'reservado'}
      data-device={mobile ? 'mobile' : 'desktop'}
      data-reserved={`${width}x${height}`}
      style={{ maxWidth: width, ...(ad ? ({ '--pt-ad-w': ad.width, '--pt-ad-h': ad.height } as CSSProperties) : {}) }}
    >
      <DsAdSlot position={position}>
        {ad ? (
          <a href={ad.href} rel="sponsored noopener noreferrer" target="_blank" aria-label={`Publicidade: ${ad.advertiser}`}>
            <img src={ad.imageSrc} alt={ad.alt} width={ad.width} height={ad.height} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </a>
        ) : (
          <span aria-hidden="true" />
        )}
      </DsAdSlot>
      {ad && (
        <p className="pt-meta" data-testid="ad-advertiser">
          {ad.label} · {ad.advertiser}
        </p>
      )}
    </div>
  );
}
