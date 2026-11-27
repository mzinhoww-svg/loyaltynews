/**
 * Porta única de saída dos eventos do portal. Nada passa sem: flag `analytics` ligada, consentimento de cookies analíticos da versão
 * vigente, sem GPC/DNT e fora de navegador automatizado. Na dúvida, não mede. Sem fila: o que aconteceu antes do consentimento se perde.
 *
 * DESTINO: não há envio externo. O evento validado só vira um `CustomEvent` dentro da própria página (EVENTO_LOCAL). Rota de coleta,
 * agregado e GA4 NÃO estão ligados a ele; ligar um destino é outra mudança.
 */
import { CHAVE_CONSENTIMENTO, lerConsentimento } from '../_consentimento/regras';

export const EVENTO_LOCAL = 'ln:evento-portal';

type Contrato = typeof import('@ln/analytics/portal');

export function podeMedir(ligada: boolean): boolean {
  if (ligada !== true) return false;
  const n = window.navigator as Navigator & { globalPrivacyControl?: boolean };
  if (n.globalPrivacyControl === true || n.doNotTrack === '1' || n.webdriver === true) return false;
  try {
    return lerConsentimento(window.localStorage.getItem(CHAVE_CONSENTIMENTO))?.analiticos === true;
  } catch {
    return false;
  }
}

/**
 * Monta, valida pelo contrato e entrega. O contrato só é carregado quando pode medir (desligado, o portal nem baixa o código).
 * Devolve `true` apenas se o evento saiu. Falha de medição nunca derruba a página.
 */
export async function emitir(ligada: boolean, montar: (contrato: Contrato) => unknown): Promise<boolean> {
  if (!podeMedir(ligada)) return false;
  try {
    const contrato = await import('@ln/analytics/portal');
    const lido = contrato.parsePortalEvent(montar(contrato));
    // Confere de novo depois da espera: o leitor pode ter revogado enquanto o contrato carregava.
    if (!lido.ok || !podeMedir(ligada)) return false;
    window.dispatchEvent(new CustomEvent(EVENTO_LOCAL, { detail: lido.event }));
    return true;
  } catch {
    return false;
  }
}

/** Perfil de pessoa e movimentação carregam o identificador (que pode ser o nome) no caminho: ele não entra no evento. */
export function caminhoSemPessoa(caminho: string): string {
  return caminho.replace(/^\/(intelligence\/pessoas|moves)\/.+$/i, '/$1/:id');
}

/** Do endereço de origem só interessa o host (vira categoria): caminho e query são descartados já no navegador. */
export function soOrigem(referrer: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const u = new URL(referrer);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return undefined;
  }
}

export const SEGUNDOS_DE_LEITURA = 30;
export const FRACAO_DO_TEXTO = 0.75;
/** Mínimo do contrato para `readSeconds`: rolar até o fim antes disso espera completar. */
export const SEGUNDOS_MINIMOS = 3;

export function leituraConta(segundosAtivos: number, passouDoTexto: boolean): boolean {
  return segundosAtivos >= SEGUNDOS_DE_LEITURA || (passouDoTexto && segundosAtivos >= SEGUNDOS_MINIMOS);
}

/** A borda de baixo da janela passou de 75% da altura do texto? */
export function passouDoCorte(texto: { top: number; height: number } | null, alturaJanela: number): boolean {
  return !!texto && texto.height > 0 && (alturaJanela - texto.top) / texto.height >= FRACAO_DO_TEXTO;
}
