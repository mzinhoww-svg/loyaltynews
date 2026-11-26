'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CHAVE_CONSENTIMENTO, configGa, gravarConsentimento, lerConsentimento, mostrarBanner, podeCarregarGa, type Consentimento as Escolha } from './regras';

type Gtag = (...args: unknown[]) => void;
type Janela = Window & { dataLayer?: unknown[]; gtag?: Gtag; [k: `ga-disable-${string}`]: boolean | undefined };

/**
 * Banner de cookies analíticos e carga do GA4 (LGPD). Nada do Google é pedido antes do aceite: o <script> do gtag só é criado no
 * navegador depois de `podeCarregarGa` ser verdadeiro. Recusar ou revogar desliga a coleta (`ga-disable-<ID>`) e não carrega nada.
 * `producao` vem do servidor (produção indexável); o ID vem de NEXT_PUBLIC_GA_ID.
 */
export function ConsentimentoCookies({ producao }: { producao: boolean }) {
  const idGa = process.env.NEXT_PUBLIC_GA_ID;
  const caminho = usePathname();
  const [escolha, setEscolha] = useState<Escolha | null | undefined>(undefined);
  const [reaberto, setReaberto] = useState(false);
  const bannerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const ler = (): Escolha | null => {
      try {
        return lerConsentimento(window.localStorage.getItem(CHAVE_CONSENTIMENTO));
      } catch {
        return null;
      }
    };
    setEscolha(ler());
    const abrir = () => {
      setEscolha(null);
      setReaberto(true);
    };
    window.addEventListener('ln-preferencias-cookies', abrir);
    return () => window.removeEventListener('ln-preferencias-cookies', abrir);
  }, []);

  // Reaberto por "Preferências de cookies": leva o foco ao aviso. No primeiro carregamento não rouba o foco;
  // o aria-live anuncia o banner a quem usa leitor de tela.
  useEffect(() => {
    if (reaberto && escolha === null) bannerRef.current?.focus();
  }, [reaberto, escolha]);

  useEffect(() => {
    if (escolha === undefined || !idGa) return;
    const w = window as unknown as Janela;
    const sinal = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true || navigator.doNotTrack === '1';
    const pode = podeCarregarGa({ idGa, producao, consentimento: escolha, sinalNaoRastrear: sinal });
    w[`ga-disable-${idGa}`] = !pode;
    if (!pode) return;
    if (!w.gtag) {
      w.dataLayer = w.dataLayer ?? [];
      w.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params -- o gtag exige o objeto arguments
        w.dataLayer!.push(arguments);
      };
      w.gtag('js', new Date());
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(idGa)}`;
      s.dataset.testid = 'ga4-tag';
      document.head.appendChild(s);
    }
    w.gtag('config', idGa, configGa(caminho ?? '/', window.location.origin));
  }, [escolha, idGa, producao, caminho]);

  const decidir = (analiticos: boolean) => {
    try {
      window.localStorage.setItem(CHAVE_CONSENTIMENTO, gravarConsentimento(analiticos));
    } catch {
      /* sem armazenamento: vale só nesta página */
    }
    setEscolha(lerConsentimento(gravarConsentimento(analiticos)));
  };

  if (escolha === undefined || !mostrarBanner({ idGa, producao, consentimento: escolha })) return null;
  return (
    <section ref={bannerRef} tabIndex={-1} aria-live="polite" className="ln-consent" role="region" aria-label="Preferências de cookies" data-testid="consentimento-banner"
      style={{ position: 'fixed', insetInline: 0, bottom: 0, zIndex: 50, background: 'var(--ln-color-surface, #fff)', borderTop: '1px solid var(--ln-color-border)', boxShadow: '0 -4px 16px rgba(0,0,0,.08)', padding: 'var(--ln-space-4, 16px)' }}>
      <div className="pt-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--ln-space-3, 12px)', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, maxWidth: 760 }}>
          Usamos cookies analíticos do Google Analytics para medir a audiência, sem anúncios e sem dados pessoais. Eles só são ativados se
          você aceitar. Veja a <Link href="/privacidade#cookies" style={{ textDecoration: 'underline' }}>política de cookies</Link>.
        </p>
        <div style={{ display: 'flex', gap: 'var(--ln-space-2, 8px)' }}>
          <button type="button" className="ln-btn ln-btn--secondary" onClick={() => decidir(false)}>Recusar</button>
          <button type="button" className="ln-btn ln-btn--secondary" onClick={() => decidir(true)}>Aceitar cookies analíticos</button>
        </div>
      </div>
    </section>
  );
}

/** Link "Preferências de cookies": reabre o banner para mudar ou revogar a escolha. */
export function LinkPreferenciasCookies() {
  return (
    <button type="button" className="pt-more" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
      onClick={() => window.dispatchEvent(new Event('ln-preferencias-cookies'))} data-testid="preferencias-cookies">
      Preferências de cookies
    </button>
  );
}
