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
