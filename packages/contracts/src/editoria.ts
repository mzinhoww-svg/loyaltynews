import { z } from 'zod';

/** As dez editorias do Blueprint 2.1 §1 (D13). O slug coincide com o sufixo dos perfis writer_/editor_ do registro de agentes. */
export const EDITORIAS = [
  { slug: 'mercado', nome: 'Mercado & Negócios' },
  { slug: 'programas', nome: 'Programas de Fidelidade' },
  { slug: 'pontos', nome: 'Pontos & Milhas' },
  { slug: 'bancos', nome: 'Bancos & Cartões' },
  { slug: 'varejo', nome: 'Varejo & Cashback' },
  { slug: 'travel', nome: 'Travel & Hospitality' },
  { slug: 'tech', nome: 'LoyaltyTech & IA' },
  { slug: 'crm', nome: 'CRM & CX' },
  { slug: 'global', nome: 'Global Loyalty' },
  { slug: 'regulacao', nome: 'Regulação & Dados' },
] as const;

export const EditoriaSlug = z.enum(EDITORIAS.map((e) => e.slug) as [
  (typeof EDITORIAS)[number]['slug'],
  ...(typeof EDITORIAS)[number]['slug'][],
]);
export type EditoriaSlug = z.infer<typeof EditoriaSlug>;

export const Editoria = z.object({ slug: EditoriaSlug, nome: z.string().min(1) });
export type Editoria = z.infer<typeof Editoria>;
