"use client";

import { useId, type FormEvent, type InputHTMLAttributes } from "react";
import { cx } from "../utils";
import { Button } from "./Button";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Rótulo visível (obrigatório: placeholder não é rótulo). */
  label: string;
  hint?: string;
  error?: string;
  id?: string;
}

export function Input({ label, hint, error, id, className, required, ...rest }: InputProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className={cx("ln-field", error && "ln-field--error", className)}>
      <label htmlFor={fid} className="ln-field__label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="ln-field__hint">
          {hint}
        </p>
      ) : null}
      <input
        id={fid}
        className="ln-field__input"
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined}
        {...rest}
      />
      {error ? (
        <p id={errId} className="ln-field__error">
          <span className="ln-sr-only">Erro: </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SearchInputProps {
  /** Chamado com o termo (trim). Vazio não dispara. */
  onSearch?: (query: string) => void;
  /** Alternativa sem JS: envia GET para `action`. */
  action?: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  label?: string;
  className?: string;
  /** Foco automático no campo (HTML `autofocus`: vale também sem JavaScript). */
  autoFocus?: boolean;
}

/** Busca: <form role="search"> com rótulo acessível e botão. */
export function SearchInput({
  onSearch,
  action,
  name = "q",
  defaultValue,
  placeholder = "Buscar no Loyalty News",
  label = "Buscar",
  className,
  autoFocus,
}: SearchInputProps) {
  const id = useId();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    if (!onSearch) return;
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get(name) ?? "").trim();
    if (q) onSearch(q);
  };
  return (
    <form role="search" aria-label={label} className={cx("ln-search", className)} action={action} method="get" onSubmit={submit}>
      <label htmlFor={id} className="ln-sr-only">
        {label}
      </label>
      <input id={id} name={name} type="search" className="ln-field__input ln-search__input" placeholder={placeholder} defaultValue={defaultValue} autoComplete="off" autoFocus={autoFocus} />
      <Button type="submit" variant="primary">
        Buscar
      </Button>
    </form>
  );
}
