/**
 * As 10 editorias do Loyalty News 2.1 (Blueprint v2.1, "Dez editorias").
 * Os slugs são o padrão de navegação da UI; a URL canônica definitiva pertence ao
 * portal/contracts (tarefa T04-02). Os componentes aceitam `hrefFor` para sobrescrever.
 */
export interface Editoria {
  slug: string;
  nome: string;
}

export const EDITORIAS: readonly Editoria[] = [
  { slug: "mercado-e-negocios", nome: "Mercado & Negócios" },
  { slug: "programas-de-fidelidade", nome: "Programas de Fidelidade" },
  { slug: "pontos-e-milhas", nome: "Pontos & Milhas" },
  { slug: "bancos-e-cartoes", nome: "Bancos & Cartões" },
  { slug: "varejo-e-cashback", nome: "Varejo & Cashback" },
  { slug: "travel-e-hospitality", nome: "Travel & Hospitality" },
  { slug: "loyaltytech-e-ia", nome: "LoyaltyTech & IA" },
  { slug: "crm-e-cx", nome: "CRM & CX" },
  { slug: "global-loyalty", nome: "Global Loyalty" },
  { slug: "regulacao-e-dados", nome: "Regulação & Dados" },
];

export const defaultEditoriaHref = (slug: string): string => `/editorias/${slug}`;
