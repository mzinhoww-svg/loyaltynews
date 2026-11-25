"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../utils";

/**
 * Grupo de links do rodapé: <nav aria-label> com um <details>. O servidor entrega o grupo ABERTO (sem JavaScript tudo aparece); abaixo de 1024 px o
 * JavaScript fecha o grupo (o título de 48 px vira o botão) e a partir de 1024 px mantém aberto (o CSS também mostra o conteúdo sempre, sem botão).
 * Esta é a mitigação para navegadores sem `::details-content` (Safari antes do 18.4), onde um <details> fechado esconderia os links no desktop.
 */
export function FooterGroup({ title, ariaLabel, wide, children, className }: { title: string; /** Nome do landmark (padrão: o título). */ ariaLabel?: string; wide?: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 1024px)");
    const aplicar = () => {
      if (ref.current) ref.current.open = mq ? mq.matches : true;
    };
    aplicar();
    mq?.addEventListener?.("change", aplicar);
    return () => mq?.removeEventListener?.("change", aplicar);
  }, []);
  return (
    <nav aria-label={ariaLabel ?? title} className={cx("ln-footer__col", wide && "ln-footer__col--wide", className)}>
      <details ref={ref} className="ln-footer__fold" open>
        <summary className="ln-footer__title">{title}</summary>
        {children}
      </details>
    </nav>
  );
}
