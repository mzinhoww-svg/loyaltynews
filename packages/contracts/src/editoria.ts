import { z } from 'zod';

import { EDITORIAS } from './editorias.data';

export { EDITORIAS };

export const EditoriaSlug = z.enum(EDITORIAS.map((e) => e.slug) as [
  (typeof EDITORIAS)[number]['slug'],
  ...(typeof EDITORIAS)[number]['slug'][],
]);
export type EditoriaSlug = z.infer<typeof EditoriaSlug>;

export const Editoria = z.object({ slug: EditoriaSlug, nome: z.string().min(1) });
export type Editoria = z.infer<typeof Editoria>;
