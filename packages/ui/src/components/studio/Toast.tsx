import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "../../utils";
import type { StatusTone } from "./StatusPill";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: StatusTone;
  /** ms até fechar sozinho. 0 = só fecha manualmente (padrão para `danger`). */
  duration?: number;
}
interface ToastItem extends Required<Pick<ToastInput, "title" | "tone">> {
  id: number;
  description?: string;
  duration: number;
}

interface ToastApi {
  push: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}
const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast deve ser usado dentro de <ToastProvider>");
  return c;
}

export function ToastProvider({ children, max = 4 }: { children: ReactNode; max?: number }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      const tone = t.tone ?? "info";
      const duration = t.duration ?? (tone === "danger" ? 0 : 6000);
      setItems((l) => [...l, { id, title: t.title, description: t.description, tone, duration }].slice(-max));
      return id;
    },
    [max],
  );
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="ln-toasts" role="region" aria-label="Notificações">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!item.duration || paused) return;
    const h = setTimeout(() => onDismiss(item.id), item.duration);
    return () => clearTimeout(h);
  }, [item.id, item.duration, paused, onDismiss]);
  return (
    <div
      className={cx("ln-toast", `ln-toast--${item.tone}`)}
      role={item.tone === "danger" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="ln-toast__text">
        <strong className="ln-toast__title">{item.title}</strong>
        {item.description ? <span className="ln-toast__desc">{item.description}</span> : null}
      </div>
      <button type="button" className="ln-toast__close" onClick={() => onDismiss(item.id)} aria-label={`Fechar notificação: ${item.title}`}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
