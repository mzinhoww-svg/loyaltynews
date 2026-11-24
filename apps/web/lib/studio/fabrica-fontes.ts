// Fontes da Fábrica editorial no Studio (DP-51): tipos da lista, resultado de uma ação NO card (sem recarregar a página) e regras puras da tela.
// A regra de negócio mora no Backend (packages/editorial): aqui só se monta a chamada e se traduz a resposta para a pessoa.

export interface FonteFabrica {
  id: string;
  /** 'padrao' | 'via-provedor' (DP-31/DP-32: lida por serviço de extração, risco aceito pelo proprietário) */
  acesso?: string;
  nome: string;
  kind: string;
  host: string;
  editorias: string[];
  termsUrl: string | null;
  pesquisa: { nivel: string | null; pesquisadoPor: string | null; trechoTermos: string | null };
  habilitada: boolean;
  termsStatus: string;
  urlVerificada: boolean;
  paywall: string;
  elegivel: boolean;
  motivosInelegivel: string[];
  /** Avisos de segurança (paywall/login, inacessível): o administrador decide, mas confirma. */
  riscos: string[];
  revisao: { revisor: string; em: string; termos: string; vencida: boolean; observacao: string | null; direta: boolean } | null;
}

/** O que uma ação no card devolve: a mensagem para o próprio card, os avisos a confirmar e a fonte já atualizada. */
export interface ResultadoCartao {
  ok: boolean;
  mensagem: string;
  /** Preenchido quando a habilitação foi recusada só porque falta a confirmação dos avisos de segurança. */
  confirmar?: string[];
  fonte?: FonteFabrica;
}

export type FiltroEstado = '' | 'desabilitadas' | 'habilitadas';
export const filtroEstado = (v: string | undefined): FiltroEstado => (v === 'desabilitadas' || v === 'habilitadas' ? v : '');

export function filtrarFontes(todas: readonly FonteFabrica[], q: string, estado: FiltroEstado): FonteFabrica[] {
  const termo = q.trim().toLowerCase();
  return todas.filter(
    (f) =>
      (!termo || f.nome.toLowerCase().includes(termo) || f.host.toLowerCase().includes(termo)) &&
      (estado === '' || (estado === 'desabilitadas' ? !f.habilitada : f.habilitada)),
  );
}

/** Quais fontes da página "Habilitar todas desta página" tenta: as desabilitadas SEM aviso de segurança (as com aviso pedem confirmação uma a uma). */
export const elegiveisParaLote = (daPagina: readonly FonteFabrica[]): FonteFabrica[] => daPagina.filter((f) => !f.habilitada && f.riscos.length === 0);

/** Texto do resumo do lote para a pessoa. */
export function resumoDoLote(n: { habilitadas: number; comAviso: number; recusadas: number }): string {
  const partes = [`${n.habilitadas} habilitada(s)`];
  if (n.comAviso) partes.push(`${n.comAviso} com aviso de segurança (habilite uma a uma, confirmando)`);
  if (n.recusadas) partes.push(`${n.recusadas} recusada(s) pelo Backend`);
  return `${partes.join('; ')}.`;
}

/** Mensagem do Backend para a pessoa; a falta de revisão (editor-chefe) aponta o administrador. */
export function mensagemDeHabilitar(codigo: string | undefined, mensagem: string, ehAdmin: boolean): string {
  if (!ehAdmin && /sem revisão registrada/i.test(mensagem)) return 'Esta fonte ainda não tem revisão dos termos. Peça a um administrador para habilitar direto, ou registre a revisão em “Detalhes e observação”.';
  if (codigo === 'FORBIDDEN') return 'Seu papel não pode habilitar esta fonte.';
  return mensagem;
}
