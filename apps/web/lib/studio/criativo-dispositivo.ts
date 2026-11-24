import { POSITIONS, creativeVariant, type AdDevice } from '@ln/commercial';

// Criativo desktop × mobile no Studio (pedido do PM sobre o `device` do ad server, ft/commercial-device 6f7eb48).
// O domínio aceita, em qualquer posição vendável, a dimensão desktop ou uma das mobile (320x100, 300x250) e deriva a variante da dimensão real.
// O Studio é mais estrito, como pedido: mobile de topo e rodapé = 320x100; mobile das laterais = 300x250. A dimensão é medida no servidor
// (na ação, antes de enviar; e de novo na rota de upload, que é a regra que vale).

const MOBILE_POR_POSICAO: Record<string, string> = { TOP: '320x100', FOOTER: '320x100', SIDEBAR_1: '300x250', SIDEBAR_2: '300x250', SIDEBAR_3: '300x250' };

export const ROTULO_DISPOSITIVO: Record<AdDevice, string> = { desktop: 'Desktop', mobile: 'Mobile' };

/** Dimensão que o arquivo precisa ter para a posição e o dispositivo; null = posição sem essa variante. */
export function dimensaoEsperada(positionId: string, dispositivo: AdDevice): string | null {
  const p = POSITIONS.find((x) => x.id === positionId);
  if (!p || p.desktop === null) return null;
  if (dispositivo === 'desktop') return p.desktop;
  const m = MOBILE_POR_POSICAO[positionId];
  return m && p.mobile.includes(m) ? m : null;
}

/** null = confere; senão, a frase da recusa (em português, com o que era esperado). */
export function conferirDimensao(positionId: string, dispositivo: AdDevice, largura: number, altura: number): string | null {
  const esperada = dimensaoEsperada(positionId, dispositivo);
  if (!esperada) return `${positionId} não tem criativo ${ROTULO_DISPOSITIVO[dispositivo].toLowerCase()} configurado.`;
  const real = `${largura}x${altura}`;
  return real === esperada ? null : `Arquivo ${real} não serve como ${ROTULO_DISPOSITIVO[dispositivo].toLowerCase()} de ${positionId}: o esperado é ${esperada}.`;
}

/** Variante de um criativo já com arquivo, pela dimensão real (regra do domínio); null = sem arquivo ou fora das dimensões. */
export const varianteDoCriativo = (c: { positionId: string; asset?: { width: number; height: number } }): AdDevice | null =>
  creativeVariant({ positionId: c.positionId, asset: c.asset as never });

export const ehDispositivo = (v: string): v is AdDevice => v === 'desktop' || v === 'mobile';
