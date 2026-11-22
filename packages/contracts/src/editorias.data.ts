// Constante sem zod: pode ir ao bundle do cliente (subpath @ln/contracts/editoria).
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

export type EditoriaSlugValue = (typeof EDITORIAS)[number]['slug'];
