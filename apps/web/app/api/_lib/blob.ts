// Porta de armazenamento de arquivos (Blob S3 compatível da Vertra, ADR-001) e adaptador S3 com assinatura SigV4.
// Sem credencial no repositório: tudo vem do ambiente (BLOB_S3_ENDPOINT, BLOB_S3_BUCKET, BLOB_S3_REGION, BLOB_S3_ACCESS_KEY_ID,
// BLOB_S3_SECRET_ACCESS_KEY; os mesmos nomes sem o prefixo BLOB_ também valem). Sem a configuração completa, getBlobStore() devolve null e as rotas de arquivo respondem
// 503 NOT_CONFIGURED: nunca há armazenamento em memória ou em disco "de mentira" em produção.
import { createHash, createHmac } from 'node:crypto';

export interface BlobObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
}

const sha256hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/** Codificação de URI da AWS: tudo, menos A-Z a-z 0-9 - _ . ~; a barra só é preservada no caminho. */
export function awsEncode(s: string, keepSlash = false): string {
  return [...s]
    .map((ch) => (/[A-Za-z0-9\-_.~]/.test(ch) || (keepSlash && ch === '/') ? ch : encodeURIComponent(ch).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)))
    .join('');
}

export interface SignInput {
  method: string;
  /** Caminho já em forma canônica (use awsEncode(path, true)). */
  canonicalPath: string;
  /** Pares de query já decodificados; a ordenação e a codificação são feitas aqui. */
  query?: Record<string, string>;
  /** Cabeçalhos a assinar (nomes em qualquer caixa); `host` e `x-amz-date` devem estar presentes. */
  headers: Record<string, string>;
  payloadSha256: string;
  amzDate: string; // AAAAMMDDTHHMMSSZ
  region: string;
  service: string;
  secretAccessKey: string;
  accessKeyId: string;
}

/** AWS Signature V4: devolve a assinatura, os cabeçalhos assinados e o valor do cabeçalho Authorization. */
export function signV4(i: SignInput): { signature: string; signedHeaders: string; authorization: string } {
  const date = i.amzDate.slice(0, 8);
  const canonicalQuery = Object.entries(i.query ?? {})
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const hdrs = Object.entries(i.headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders = hdrs.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = hdrs.map(([k]) => k).join(';');
  const canonicalRequest = [i.method.toUpperCase(), i.canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, i.payloadSha256].join('\n');
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${i.secretAccessKey}`, date);
  const kRegion = hmac(kDate, i.region);
  const kService = hmac(kRegion, i.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    signature,
    signedHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface S3Config {
  endpoint: string; // https://host[:porta] (estilo caminho: /{bucket}/{chave})
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3BlobStore implements BlobStore {
  constructor(
    private readonly cfg: S3Config,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async send(method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Uint8Array, contentType?: string): Promise<Response> {
    const u = new URL(this.cfg.endpoint);
    const path = `/${awsEncode(this.cfg.bucket)}/${awsEncode(key, true)}`;
    const amzDate = this.now().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const payloadSha256 = sha256hex(body ?? '');
    const headers: Record<string, string> = { host: u.host, 'x-amz-content-sha256': payloadSha256, 'x-amz-date': amzDate };
    if (contentType) headers['content-type'] = contentType;
    const { authorization } = signV4({
      method, canonicalPath: path, headers, payloadSha256, amzDate, region: this.cfg.region, service: 's3',
      secretAccessKey: this.cfg.secretAccessKey, accessKeyId: this.cfg.accessKeyId,
    });
    const { host: _h, ...sendHeaders } = headers;
    void _h;
    return this.fetcher(`${u.origin}${path}`, { method, headers: { ...sendHeaders, authorization }, body: body as BodyInit | undefined });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const r = await this.send('PUT', key, bytes, contentType);
    if (!r.ok) throw new Error(`S3 PUT falhou: ${r.status}`);
  }

  async get(key: string): Promise<BlobObject | null> {
    const r = await this.send('GET', key);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`S3 GET falhou: ${r.status}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    const r = await this.send('DELETE', key);
    if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE falhou: ${r.status}`);
  }
}

/** Armazenamento do ambiente, ou null se a configuração S3 não está completa. */
export function getBlobStore(env: Record<string, string | undefined> = process.env): BlobStore | null {
  // Nomes do contrato de ambiente (infra/vertra/env-contract.json): BLOB_S3_*; os S3_* seguem aceitos (ambiente local e testes).
  const S3_ENDPOINT = env.BLOB_S3_ENDPOINT || env.S3_ENDPOINT;
  const S3_BUCKET = env.BLOB_S3_BUCKET || env.S3_BUCKET;
  const S3_REGION = env.BLOB_S3_REGION || env.S3_REGION;
  const S3_ACCESS_KEY_ID = env.BLOB_S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID;
  const S3_SECRET_ACCESS_KEY = env.BLOB_S3_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  if (!/^https?:\/\//i.test(S3_ENDPOINT)) return null;
  return new S3BlobStore({ endpoint: S3_ENDPOINT, bucket: S3_BUCKET, region: S3_REGION || 'us-east-1', accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY });
}
