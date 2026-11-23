import type { UploadedMedia } from '../mlabs/create-post-draft';
import type { CreativeAsset } from '../types';

/**
 * Porta genérica de envio de mídia (legado). O envio real ao mLabs NÃO passa por aqui: ele é método do publicador
 * (`publisher.uploadMedia`, R5-02), com identidade, flag e capability de escrita; ver `raster-upload.ts`. Esta porta fica só
 * para quem precisa de um envio simulado sem publicador (`media.mock.ts`).
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
