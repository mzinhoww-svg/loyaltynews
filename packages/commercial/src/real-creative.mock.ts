// Apoio de teste: conteúdo de criativo "real" (arquivo, alt, anunciante e destino) válido para cada posição configurada.
// Só testes importam este arquivo; não entra no pacote (nenhum módulo de src/ o importa).
import { POSITIONS } from './inventory';
import type { CreativeAsset } from './creative';

export function realContent(positionId: string = 'TOP', over: Partial<{ asset: CreativeAsset; altText: string; destinationUrl: string; advertiserName: string }> = {}) {
  const p = POSITIONS.find((x) => x.id === positionId);
  const [width, height] = (p?.desktop ?? '1280x150').split('x').map(Number) as [number, number];
  return {
    asset: { key: `ads/teste/${positionId}.png`, mime: 'image/png' as const, width, height, sizeKB: 50, sha256: 'ab'.repeat(32) },
    altText: 'Anúncio de teste',
    advertiserName: 'Anunciante Teste',
    destinationUrl: 'https://anunciante.example/oferta',
    ...over,
  };
}

/** Criativo real na variante MOBILE da posição (320x100 ou 300x250). Hash e chave diferentes do desktop. */
export function realMobileContent(positionId: string = 'TOP', size: '320x100' | '300x250' = '320x100') {
  const [width, height] = size.split('x').map(Number) as [number, number];
  return realContent(positionId, { asset: { key: `ads/teste/${positionId}-${size}.png`, mime: 'image/png', width, height, sizeKB: 30, sha256: 'cd'.repeat(32) } });
}
