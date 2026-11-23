import type { UploadedMedia } from '../mlabs/create-post-draft';
import type { CreativeAsset } from '../types';

/**
 * Porta do envio de mídia ao mLabs (`upload_media`/`get_media_upload`). O criativo do Growth é SVG; o LinkedIn exige imagem
 * raster (PNG/JPG): a conversão e o envio reais NÃO existem ainda (sem rasterizador no repositório e sem teste de upload em
 * página de teste, R5-02). Por isso a implementação real recusa com uma razão clara, em vez de fingir.
 */
export interface MediaUploader {
  upload(asset: CreativeAsset, imageRef: string): Promise<UploadedMedia>;
}

export class MediaUnavailable extends Error {
  readonly reason = 'rasterizacao_e_upload_ausentes' as const;
  constructor() {
    super('envio de mídia ao mLabs indisponível: falta rasterizar o criativo (SVG→PNG) e validar o upload (R5-02)');
    this.name = 'MediaUnavailable';
  }
}

/** Implementação real padrão: recusa. Troque por um uploader validado quando R5-02 existir. */
export const unavailableUploader: MediaUploader = {
  async upload() {
    throw new MediaUnavailable();
  },
};
