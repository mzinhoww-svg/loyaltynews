export const CLASSE_C: RegExp;
export interface SondaDeps {
  robotsAllows?: (url: string) => Promise<{ allowed: boolean; note: string; sitemaps?: string[] }>;
  fetchText?: (url: string) => Promise<{
    status: number;
    finalUrl: string;
    location?: string | null;
    contentType: string;
    html: string;
    text: string;
    estado: string;
    observacao: string;
  }>;
  sleep?: (ms: number) => Promise<void>;
}
export interface SondaRow {
  id: string;
  url: string;
  estado: string;
  observacao: string;
  robots: string | null;
  sitemaps: string[];
  http_status: number | null;
  final_url: string | null;
  redireciona_para: string | null;
  texto_caracteres: number;
  renderizacao: string | null;
  titulo: string | null;
  feeds_declarados: string[];
}
export function sonda(src: { id: string; nome: string; url: string; tipo?: string; nota?: string }, deps?: SondaDeps): Promise<SondaRow>;
