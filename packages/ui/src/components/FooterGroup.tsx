"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../utils";

/**
 * Grupo de links do rodapé: <nav aria-label> com um <details>.
 *
 * O grupo nasce RECOLHIDO no HTML (sem `open`): abaixo de 1024 px ele já está fechado no primeiro paint e não há fechamento depois
 * do paint — era isso que dava CLS 0,143–0,196 em página curta (auditoria de 25/11). Sem JavaScript o <summary> continua sendo o
 * botão nativo do <details>, então o conteúdo segue alcançável.
 *
 * A partir de 1024 px o CSS mostra o conteúdo do <details> fechado (`::details-content`), sem botão; o efeito abaixo só abre o
 * atributo para navegadores sem `::details-content` (Safari antes do 18.4). Abrir no desktop cresce o rodapé para baixo, sem
 * deslocar conteúdo visível — não gera CLS.
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
    // Impressão: o navegador não abre <details> fechado no papel em todo engine; abrir antes de imprimir garante todos os links.
    const abrirParaImprimir = () => {
      if (ref.current) ref.current.open = true;
    };
    window.addEventListener("beforeprint", abrirParaImprimir);
    window.addEventListener("afterprint", aplicar);
    return () => {
      mq?.removeEventListener?.("change", aplicar);
      window.removeEventListener("beforeprint", abrirParaImprimir);
      window.removeEventListener("afterprint", aplicar);
    };
  }, []);
  return (
    <nav aria-label={ariaLabel ?? title} className={cx("ln-footer__col", wide && "ln-footer__col--wide", className)}>
      <details ref={ref} className="ln-footer__fold">
        <summary className="ln-footer__title">{title}</summary>
        {children}
      </details>
    </nav>
  );
}
