/**
 * As 10 editorias vêm de `@ln/contracts` (Blueprint 2.1 §1, D13): uma única fonte de verdade.
 * O design system não define slugs próprios.
 */
export { EDITORIAS } from "@ln/contracts/editoria";

/** Forma mínima que os componentes aceitam (compatível com `Editoria` do contrato). */
export interface EditoriaLike {
  slug: string;
  nome: string;
}

/** URL padrão de uma editoria; o portal pode sobrescrever com `hrefFor`. */
export const defaultEditoriaHref = (slug: string): string => `/editorias/${slug}`;
