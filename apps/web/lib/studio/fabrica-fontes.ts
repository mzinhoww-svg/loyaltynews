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

const MOTIVOS: Record<string, string> = {
  source_disabled: 'a fonte está desabilitada',
  robots_not_respected: 'o cadastro diz que a fonte não respeita o robots.txt: corrija o cadastro antes de habilitar',
  shared_host_needs_path_prefix: 'host compartilhado (ex.: gov.br) sem prefixo de caminho: ajuste o cadastro da fonte',
  url_unverified: 'URL não verificada',
  paywall_login: 'exige login',
  paywall_metered: 'limite de leituras (paywall)',
  paywall_unknown: 'paywall desconhecido',
};

/**
 * Qualquer recusa do Backend (409/422/400) aparece NO CARD com o motivo e o que fazer em seguida. O texto do Backend vai primeiro (nada é escondido);
 * a orientação vem depois, pelo tipo de recusa. Nunca devolve só "erro".
 */
export function explicarRecusa(status: number, mensagem: string, detalhes?: unknown): string {
  const razoes = (detalhes as { reasons?: string[] } | undefined)?.reasons;
  const motivos = Array.isArray(razoes) ? razoes.map((r) => MOTIVOS[r] ?? r).join('; ') : '';
  const base = motivos ? `${mensagem}: ${motivos}` : mensagem;
  const m = mensagem;
  let fazer: string;
  if (/aviso de segurança|precisaConfirmar|confirme para habilitar/i.test(m)) fazer = 'marque “Entendi o aviso de segurança” no card e habilite de novo.';
  else if (/sem revisão registrada/i.test(m)) fazer = 'peça a um administrador para habilitar direto, ou registre a revisão em “Registrar revisão dos termos”.';
  else if (/revisão vencida/i.test(m)) fazer = 'a definição da fonte mudou: registre uma nova revisão, ou o administrador habilita direto.';
  else if (/revisor (precisa ser diferente|não pode ser o mesmo)|pesquisador da fonte desconhecido/i.test(m)) fazer = 'outra pessoa precisa revisar; ou o administrador habilita direto.';
  else if (/DP-3[12]/i.test(m)) fazer = 'cite a DP-31 ou a DP-32 na nota (risco aceito pelo proprietário), ou o administrador habilita direto confirmando o aviso. A coleta dessa fonte usa um provedor tarifado.';
  else if (/inacessível na pesquisa/i.test(m)) fazer = 'a fonte não foi lida na pesquisa: só o administrador habilita, confirmando o aviso de segurança.';
  else if (/URL verificada e robots/i.test(m)) fazer = 'marque “URL verificada” e “robots.txt conferido” na revisão.';
  else if (/login\/paywall/i.test(m)) fazer = 'fonte com login ou paywall não passa na revisão formal; o administrador pode habilitar confirmando o aviso.';
  else if (/termsNote/i.test(m)) fazer = 'a nota da revisão formal precisa ter pelo menos 20 caracteres (a habilitação direta do administrador não pede nota).';
  else if (/inelegível/i.test(m)) fazer = 'corrija o que o cadastro da fonte indica acima; esta recusa não é de termos e o administrador não a contorna.';
  else if (status === 403) fazer = 'seu papel não faz isso; peça a um administrador.';
  else fazer = 'confira os dados e tente de novo; se continuar, avise um administrador.';
  return `${base.replace(/[.\s]+$/, '')}. O que fazer: ${fazer}`;
}
