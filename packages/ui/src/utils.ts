import type { ElementType } from "react";

/** Junta classes ignorando valores falsy. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

/** Componente de link injetável (ex.: `next/link`). Padrão: `<a>`. */
export type LinkAs = ElementType;

/** Data curta pt-BR ("20 nov 2026"), fuso de Brasília, determinística. Para cartões e listas densas. */
export function formatDateShortPtBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short", year: "numeric" })
    .format(d)
    .replace(/\s+de\s+/g, " ")
    .replace(/\./g, "");
}

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
