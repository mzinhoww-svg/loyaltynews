/**
 * Pedido do titular (DP-38): regras de validação do lado do portal, iguais às do Backend
 * (apps/web/app/api/_lib/titular.ts, `PedidoTitular`). O Backend continua sendo quem decide; aqui é só para orientar o leitor
 * antes de enviar. A resposta traz um protocolo público e o prazo; o portal não mostra o id interno.
 */
export const ROTA_PEDIDO = '/api/publico/correcoes';

/** Prazo de resposta mostrado antes do envio. Tem de bater com PRAZO_DIAS do Backend (o teste confere). */
export const PRAZO_DIAS_RESPOSTA = 15;

export interface ReciboPedido {
  protocolo: string;
  prazoDias: number;
  /** ISO do fim do prazo, calculado pelo Backend a partir do recebimento. */
  prazoEm: string;
}

/** Lê o recibo só quando a resposta tem a forma esperada; sem isso, a tela usa o texto genérico. */
export function reciboDaResposta(body: unknown): ReciboPedido | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const protocolo = typeof b.protocolo === 'string' ? b.protocolo : '';
  const prazoEm = typeof b.prazoEm === 'string' ? b.prazoEm : '';
  const prazoDias = typeof b.prazoDias === 'number' ? b.prazoDias : PRAZO_DIAS_RESPOSTA;
  if (!/^LN-[0-9A-F]{12}$/.test(protocolo) || !prazoEm) return null;
  return { protocolo, prazoDias, prazoEm };
}

/** Data do prazo no fuso de Brasília, para não adiantar um dia no navegador do leitor. */
export function dataDoPrazo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export type TipoPedido = 'correcao' | 'remocao';
export interface PedidoValores {
  nome: string;
  contato: string;
  url: string;
  tipo: string;
  texto: string;
}
export type PedidoErros = Partial<Record<keyof PedidoValores, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarPedido(v: PedidoValores): PedidoErros {
  const e: PedidoErros = {};
  const nome = v.nome.trim();
  if (nome.length < 2 || nome.length > 200) e.nome = 'Informe seu nome (2 a 200 caracteres).';
  const contato = v.contato.trim();
  if (!EMAIL.test(contato) || contato.length > 320) e.contato = 'Informe um e-mail válido para respondermos.';
  const url = v.url.trim();
  const urlOk = (() => {
    try {
      return /^https?:$/.test(new URL(url).protocol) && url.length <= 2048;
    } catch {
      return false;
    }
  })();
  if (!urlOk) e.url = 'Cole o endereço completo da página (começando com http:// ou https://).';
  if (v.tipo !== 'correcao' && v.tipo !== 'remocao') e.tipo = 'Escolha correção ou remoção.';
  const texto = v.texto.trim();
  if (texto.length < 10 || texto.length > 5000) e.texto = 'Descreva o pedido (10 a 5.000 caracteres).';
  return e;
}

/**
 * Endereço pré-preenchido a partir de `?alvo=` (caminho interno vindo do botão do perfil). Só aceita caminho do próprio site
 * (começa com "/" e não com "//"), para o link não virar um jeito de injetar outro domínio no formulário.
 */
export function urlDoAlvo(alvo: string | null, origin: string): string {
  if (!alvo || !alvo.startsWith('/') || alvo.startsWith('//') || alvo.includes('\\') || alvo.length > 512) return '';
  try {
    const u = new URL(alvo, origin);
    return u.origin === new URL(origin).origin ? u.href : '';
  } catch {
    return '';
  }
}

export type EstadoEnvio = 'recebido' | 'invalido' | 'muitos' | 'falha';

/** Traduz a resposta HTTP do Backend no estado da tela. */
export function estadoDaResposta(status: number): EstadoEnvio {
  if (status === 202 || status === 200) return 'recebido';
  if (status === 400 || status === 413 || status === 415) return 'invalido';
  if (status === 429) return 'muitos';
  return 'falha';
}

/** Link do botão do perfil: leva ao formulário com a página já indicada. */
export const linkPedido = (caminho: string) => `/correcoes?alvo=${encodeURIComponent(caminho)}#pedido`;
