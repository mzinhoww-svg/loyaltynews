import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../../utils";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  /** Rótulo da lista de abas (obrigatório para leitores de tela). */
  label: string;
  defaultTabId?: string;
  /** Modo controlado. */
  selectedId?: string;
  onChange?: (id: string) => void;
  className?: string;
}

/** Abas WAI-ARIA: setas ←/→, Home/End, ativação automática, tabindex móvel. */
export function Tabs({ tabs, label, defaultTabId, selectedId, onChange, className }: TabsProps) {
  const base = useId();
  const firstEnabled = tabs.find((t) => !t.disabled)?.id ?? tabs[0]?.id ?? "";
  const [inner, setInner] = useState(defaultTabId ?? firstEnabled);
  const current = selectedId ?? inner;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string, focus = false) => {
    if (selectedId === undefined) setInner(id);
    onChange?.(id);
    if (focus) refs.current[id]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.id === current);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(enabled[next]!.id, true);
  };

  return (
    <div className={cx("ln-tabs", className)}>
      <div role="tablist" aria-label={label} className="ln-tabs__list">
        {tabs.map((t) => {
          const active = t.id === current;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              role="tab"
              type="button"
              id={`${base}-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              disabled={t.disabled}
              className="ln-tabs__tab"
              onClick={() => select(t.id)}
              onKeyDown={onKey}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== current}
          tabIndex={0}
          className="ln-tabs__panel"
        >
          {t.id === current ? t.content : null}
        </div>
      ))}
    </div>
  );
}
