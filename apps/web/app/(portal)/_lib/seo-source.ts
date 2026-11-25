import { ogImagemPadrao, type OgImagem } from './seo';
import { getSource } from './source';

/** Imagem de compartilhamento das listagens e páginas sem imagem própria: a publicada no Studio (seo.ogImage) ou a padrão da marca. O `openGraph` de uma página substitui o do layout, então cada página repete a imagem. */
export async function ogImagensDaPagina(): Promise<Pick<OgImagem, 'url' | 'width' | 'height' | 'alt'>[]> {
  const publicada = (await getSource().getSiteConfig())?.seo?.ogImage;
  return [publicada ? { url: publicada, width: 1200, height: 630, alt: 'Loyalty News' } : ogImagemPadrao()];
}
