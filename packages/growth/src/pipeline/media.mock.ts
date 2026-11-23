// MOCK — envio de mídia simulado: devolve ids `SIM-IMG-…` derivados da referência; não envia nada a lugar nenhum.
import type { UploadedMedia } from '../mlabs/create-post-draft';
import type { CreativeAsset } from '../types';
import type { MediaUploader } from './media';

export class SimulatedMediaUploader implements MediaUploader {
  readonly MOCK = true as const;
  readonly uploads: string[] = [];
  /** Quando `true`, o próximo envio falha (mídia indisponível). */
  failNext = false;

  async upload(_asset: CreativeAsset, imageRef: string): Promise<UploadedMedia> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('upload simulado indisponível');
    }
    this.uploads.push(imageRef);
    return { imageIds: [`SIM-IMG-${imageRef.split('/').pop() ?? 'x'}`] };
  }
}
