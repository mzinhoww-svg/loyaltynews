"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Título (obrigatório): nomeia o diálogo via aria-labelledby. */
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** center = Modal; right = Drawer. */
  placement?: "center" | "right";
  closeOnBackdrop?: boolean;
  className?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal acessível: role=dialog + aria-modal, foco preso, Esc fecha,
 * foco volta ao elemento que abriu, rolagem da página travada enquanto aberto.
 */
export function Modal({ open, onClose, title, children, footer, size = "md", placement = "center", closeOnBackdrop = true, className }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialogRef.current)?.focus();
    return () => {
      document.body.style.overflow = prev;
      openerRef.current?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="ln-root ln-modal-root">
      <div className="ln-modal__backdrop" data-testid="modal-backdrop" onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cx("ln-modal", `ln-modal--${size}`, placement === "right" && "ln-modal--drawer", className)}
          onKeyDown={onKeyDown}
        >
          <div className="ln-modal__header">
            <h2 id={titleId} className="ln-modal__title">
              {title}
            </h2>
            <button type="button" className="ln-modal__close" onClick={onClose} aria-label="Fechar">
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="ln-modal__body">{children}</div>
          {footer ? <div className="ln-modal__footer">{footer}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Painel lateral: Modal com `placement="right"`. */
export function Drawer(props: Omit<ModalProps, "placement">) {
  return <Modal {...props} placement="right" />;
}
