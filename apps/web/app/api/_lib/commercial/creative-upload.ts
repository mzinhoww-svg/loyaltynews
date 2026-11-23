// Upload do arquivo do criativo (Studio): multipart → Blob → `setCreativeContent` do domínio. Tipo e dimensões saem do CABEÇALHO do arquivo, medidos AQUI
// (nada que o cliente declare vale); peso e hash também. O que não casa com a posição é recusado (422 com a lista do que falta) ANTES de gravar. Trocar o arquivo
// REVOGA a aprovação (regra do domínio): o criativo volta a ser aprovado por uma pessoa. Só quem gerencia o comercial (campanhas e inventário: update).
import { can } from '@ln/auth';
import { POSITIONS, validateCreative, type Creative } from '@ln/commercial';
import { ROUTES } from '@ln/commercial/api';
import { z } from 'zod';
import { getBlobStore } from '../blob';
import { HttpError, json, type RouteCtx, type RouteFn } from '../http';
import { creativeBlobKey, readImageInfo, sha256Hex, sizeKB } from './creative-file';
import { runCommercialWrite, saoPauloDate } from './index';
import { loadCreatives } from './repo';

/** Teto absoluto do corpo (as posições pedem muito menos: TOP ≤ 200 KB). */
const MAX_BYTES = 1_000_000;
const Fields = z.object({
  creativeId: z.string().min(1).max(128),
  altText: z.string().trim().min(1).max(200).optional(),
  destinationUrl: z.string().max(2000).optional(),
  advertiserName: z.string().trim().min(1).max(80).optional(),
});

export const uploadCreativeFile: RouteFn = async (req, c: RouteCtx) => {
  const role = c.session!.role;
  if (!(can(role, 'campanhas', 'update') && can(role, 'inventario', 'update'))) throw new HttpError(403, 'FORBIDDEN', 'Sem permissão para gerenciar criativos.');
  const blob = c.deps.blob === undefined ? getBlobStore() : c.deps.blob;
  if (!blob) throw new HttpError(503, 'BLOB_NOT_CONFIGURED', 'Armazenamento de arquivos não configurado neste ambiente.');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES + 100_000) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Arquivo acima do limite.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'INVALID_MULTIPART', 'Envie multipart/form-data com creativeId e arquivo.');
  }
  const file = form.get('arquivo');
  if (!(file instanceof File)) throw new HttpError(400, 'VALIDATION_ERROR', 'Campo arquivo ausente.', [{ path: 'arquivo', message: 'obrigatório' }]);
  const fields = Fields.safeParse(Object.fromEntries(['creativeId', 'altText', 'destinationUrl', 'advertiserName'].flatMap((k) => (form.get(k) ? [[k, String(form.get(k))]] : []))));
  if (!fields.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Campos inválidos.', fields.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Arquivo fora do limite (${MAX_BYTES} bytes).`);

  const info = readImageInfo(bytes);
  if (!info) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Só JPEG, PNG ou GIF íntegros (o cabeçalho do arquivo é lido no servidor).');
  const creatives = await loadCreatives(c.deps.db);
  const atual = creatives.find((x) => x.id === fields.data.creativeId);
  if (!atual) throw new HttpError(404, 'NOT_FOUND', 'Criativo não encontrado.');
  const sha256 = sha256Hex(bytes);
  const asset = { key: creativeBlobKey(sha256, info.ext), mime: info.mime, width: info.width, height: info.height, sizeKB: sizeKB(bytes.length), sha256 };

  // o arquivo precisa casar com a posição (dimensão exata, peso máximo, tipo permitido): recusa ANTES de gravar no Blob
  const candidato: Creative = { ...atual, asset };
  const problemas = validateCreative(candidato, POSITIONS).filter((i) => ['NO_ASSET', 'BAD_MIME', 'BAD_DIMENSIONS', 'TOO_HEAVY', 'NO_HASH', 'POSITION_UNKNOWN', 'POSITION_NOT_CONFIGURED'].includes(i.code));
  if (problemas.length > 0) throw new HttpError(422, 'CREATIVE_FILE_INVALID', 'O arquivo não atende à posição.', problemas);

  await blob.put(asset.key, bytes, info.mime); // endereçado pelo conteúdo: repetir é inofensivo
  const now = c.deps.now();
  const extra = { now: now.toISOString(), today: saoPauloDate(now), flags: c.deps.flags, actor: { id: c.session!.userId, canManageCommercial: true } };
  const route = ROUTES.find((r) => r.path === '/api/commercial/studio/creatives/content')!;
  const input = { creativeId: fields.data.creativeId, asset, ...(fields.data.altText ? { altText: fields.data.altText } : {}), ...(fields.data.destinationUrl ? { destinationUrl: fields.data.destinationUrl } : {}), ...(fields.data.advertiserName ? { advertiserName: fields.data.advertiserName } : {}) };
  const res = await runCommercialWrite(route, input, c, extra);
  if (res.status >= 400) return json(res.body, res.status);
  return json({ ...(res.body as object), arquivo: { mime: asset.mime, width: asset.width, height: asset.height, sizeKB: asset.sizeKB, sha256 } }, 200);
};
