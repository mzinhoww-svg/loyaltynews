// INTERNO: tipos do adaptador com escrita. Não reexportado pelo índice (nem em tipos): o pacote não oferece
// nenhuma forma pública de obter ou tipar um adaptador com `createPost`.
import type { MlabsReadPort, PostPayload, PublishReceipt } from './port';
import type { MediaUploadPort, PutBytes } from '../pipeline/raster-upload';
import type { WriteCapability } from './write-gate.internal';

export interface MlabsWritePort {
  /** Vincula a capability do publicador. Uma única vez por adaptador. */
  bindWriteAuthority(cap: WriteCapability): void;
  createPost(cap: WriteCapability, payload: PostPayload, idempotencyKey: string): Promise<PublishReceipt>;
  updatePost(cap: WriteCapability, receiptId: string, patch: Partial<Pick<PostPayload, 'text' | 'scheduleAt'>>): Promise<PublishReceipt>;
  deletePost(cap: WriteCapability, receiptId: string): Promise<PublishReceipt>;
  /** Porta de envio de mídia (prepare_media_upload é ESCRITA): só com a capability do publicador. Cada chamada da porta reconfere identidade e flag. */
  mediaUploadPort(cap: WriteCapability, putBytes?: PutBytes): MediaUploadPort;
}

export type MlabsAdapter = MlabsReadPort & MlabsWritePort;
