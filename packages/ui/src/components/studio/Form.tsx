"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { cx } from "../../utils";
import { Button } from "../Button";

/** Validador: devolve a mensagem de erro ou `undefined` se válido. */
export type Validator = (value: string) => string | undefined;

export const rules = {
  required: (msg = "Campo obrigatório."): Validator => (v) => (v.trim() === "" ? msg : undefined),
  minLength: (n: number, msg?: string): Validator => (v) => (v !== "" && v.trim().length < n ? (msg ?? `Use ao menos ${n} caracteres.`) : undefined),
  maxLength: (n: number, msg?: string): Validator => (v) => (v.length > n ? (msg ?? `Use no máximo ${n} caracteres.`) : undefined),
  email: (msg = "Informe um e-mail válido."): Validator => (v) => (v !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? msg : undefined),
  pattern: (re: RegExp, msg: string): Validator => (v) => (v !== "" && !re.test(v) ? msg : undefined),
  url: (msg = "Informe uma URL começando com http:// ou https://."): Validator => (v) => (v !== "" && !/^https?:\/\/\S+$/i.test(v) ? msg : undefined),
};

type Values = Record<string, string>;
interface Registered {
  label: string;
  id: string;
  rules: Validator[];
}
interface Ctx {
  values: Values;
  errors: Record<string, string | undefined>;
  setValue: (name: string, value: string) => void;
  blur: (name: string) => void;
  register: (name: string, r: Registered) => void;
  disabled: boolean;
}
const FormCtx = createContext<Ctx | null>(null);

export interface FormProps {
  initialValues: Values;
  onSubmit: (values: Values) => void | Promise<void>;
  children: ReactNode;
  submitLabel?: string;
  summaryTitle?: string;
  /** Mensagem de falha do envio (ex.: erro da API); aparece no resumo de erros. */
  submitError?: string;
  className?: string;
}

/**
 * Formulário com validação acessível: valida ao sair do campo e ao enviar; ao enviar com erro,
 * mostra um resumo (role=alert) com links para cada campo e move o foco para ele.
 */
export function Form({ initialValues, onSubmit, children, submitLabel = "Salvar", summaryTitle = "Corrija os campos abaixo", submitError, className }: FormProps) {
  const [values, setValues] = useState<Values>(initialValues);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const reg = useRef<Record<string, Registered>>({});
  const summary = useRef<HTMLDivElement>(null);

  const validate = useCallback((name: string, v: string): string | undefined => {
    for (const rule of reg.current[name]?.rules ?? []) {
      const msg = rule(v);
      if (msg) return msg;
    }
    return undefined;
  }, []);

  const setValue = useCallback(
    (name: string, v: string) => {
      setValues((s) => ({ ...s, [name]: v }));
      // reavalia ao digitar só se o campo já está com erro (feedback sem ruído)
      setErrors((e) => (e[name] ? { ...e, [name]: validate(name, v) } : e));
    },
    [validate],
  );
  const blur = useCallback((name: string) => setErrors((e) => ({ ...e, [name]: validate(name, values[name] ?? "") })), [validate, values]);
  const register = useCallback((name: string, r: Registered) => {
    reg.current[name] = r;
  }, []);

  const errorList = Object.entries(errors).filter(([, m]) => Boolean(m)) as Array<[string, string]>;

  useEffect(() => {
    if (attempt > 0 && errorList.length > 0) summary.current?.focus();
    // foco só quando uma nova tentativa de envio falha
  }, [attempt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string | undefined> = {};
    for (const name of Object.keys(reg.current)) next[name] = validate(name, values[name] ?? "");
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      setAttempt((n) => n + 1);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  const focusField = (name: string) => document.getElementById(reg.current[name]?.id ?? "")?.focus();

  return (
    <FormCtx.Provider value={{ values, errors, setValue, blur, register, disabled: submitting }}>
      <form className={cx("ln-form", className)} onSubmit={submit} noValidate>
        {errorList.length > 0 || submitError ? (
          <div ref={summary} tabIndex={-1} role="alert" className="ln-form__summary">
            <p className="ln-form__summary-title">{submitError ? "Não foi possível enviar" : summaryTitle}</p>
            {submitError ? <p>{submitError}</p> : null}
            {errorList.length > 0 ? (
              <ul>
                {errorList.map(([name, msg]) => (
                  <li key={name}>
                    <a
                      href={`#${reg.current[name]?.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        focusField(name);
                      }}
                    >
                      {reg.current[name]?.label}: {msg}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {children}
        <div className="ln-form__actions">
          <Button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
            {submitting ? "Salvando…" : submitLabel}
          </Button>
        </div>
      </form>
    </FormCtx.Provider>
  );
}

export interface FormFieldProps {
  name: string;
  label: string;
  hint?: string;
  type?: "text" | "email" | "url" | "number" | "date" | "password";
  as?: "input" | "textarea" | "select";
  options?: ReadonlyArray<{ value: string; label: string }>;
  rows?: number;
  required?: boolean;
  rules?: Validator[];
  placeholder?: string;
  className?: string;
}

/** Campo ligado ao <Form>: rótulo, dica, erro (aria-describedby/aria-invalid) e validação. */
export function FormField({ name, label, hint, type = "text", as = "input", options, rows = 4, required, rules: extra = [], placeholder, className }: FormFieldProps) {
  const ctx = useContext(FormCtx);
  if (!ctx) throw new Error("FormField deve ser usado dentro de <Form>");
  const base = useId();
  const id = `${base}-${name}`;
  const all = required ? [rules.required(), ...extra] : extra;
  ctx.register(name, { label, id, rules: all });
  const value = ctx.values[name] ?? "";
  const error = ctx.errors[name];
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const common = {
    id,
    name,
    value,
    required: required || undefined,
    "aria-required": required || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined,
    disabled: ctx.disabled,
    onBlur: () => ctx.blur(name),
    className: "ln-field__input",
  };
  return (
    <div className={cx("ln-field", error && "ln-field--error", className)}>
      <label htmlFor={id} className="ln-field__label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="ln-field__hint">
          {hint}
        </p>
      ) : null}
      {as === "textarea" ? (
        <textarea {...common} rows={rows} placeholder={placeholder} onChange={(e) => ctx.setValue(name, e.target.value)} />
      ) : as === "select" ? (
        <select {...common} onChange={(e) => ctx.setValue(name, e.target.value)}>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input {...common} type={type} placeholder={placeholder} onChange={(e) => ctx.setValue(name, e.target.value)} />
      )}
      {error ? (
        <p id={errId} className="ln-field__error">
          <span className="ln-sr-only">Erro: </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
