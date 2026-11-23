import type { ElementType } from "react";

/** Junta classes ignorando valores falsy. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

/** Componente de link injetável (ex.: `next/link`). Padrão: `<a>`. */
export type LinkAs = ElementType;

/** Formata ISO 8601 em pt-BR, fuso de Brasília, de forma determinística. */
export function formatDatePtBR(iso: string, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}
