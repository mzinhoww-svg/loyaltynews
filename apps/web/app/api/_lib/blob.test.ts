import { describe, expect, it } from 'vitest';
import { awsEncode, getBlobStore, S3BlobStore, signV4 } from './blob';

describe('AWS Signature V4', () => {
  it('reproduz o vetor oficial da AWS (GET iam ListUsers, 20150830): assinatura idêntica', () => {
    const r = signV4({
      method: 'GET',
      canonicalPath: '/',
      query: { Action: 'ListUsers', Version: '2010-05-08' },
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', host: 'iam.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      amzDate: '20150830T123600Z',
      region: 'us-east-1',
      service: 'iam',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    });
    expect(r.signature).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
    expect(r.signedHeaders).toBe('content-type;host;x-amz-date');
    expect(r.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  it('awsEncode: reservados codificados, barra preservada só no caminho', () => {
    expect(awsEncode('a b/c+d')).toBe('a%20b%2Fc%2Bd');
    expect(awsEncode('midia/abc def.png', true)).toBe('midia/abc%20def.png');
    expect(awsEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(awsEncode('A-z_0.9~')).toBe('A-z_0.9~');
  });
});

describe('S3BlobStore', () => {
  const cfg = { endpoint: 'https://s3.example.test:9000', bucket: 'ln-midia', region: 'sa-east-1', accessKeyId: 'AKTEST', secretAccessKey: 'segredo-de-teste' };
  const fixed = () => new Date('2026-11-22T12:00:00Z');

  it('PUT estilo caminho, cabeçalhos assinados, sha256 do corpo e credencial com escopo da região; o segredo nunca vai na requisição', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const s = new S3BlobStore(cfg, fake, fixed);
    await s.put('midia/abc', new Uint8Array([1, 2, 3]), 'image/png');
    const c = calls[0]!;
    expect(c.url).toBe('https://s3.example.test:9000/ln-midia/midia/abc');
    expect(c.init.method).toBe('PUT');
    const h = c.init.headers as Record<string, string>;
    expect(h['x-amz-date']).toBe('20261122T120000Z');
    expect(h['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKTEST\/20261122\/sa-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(JSON.stringify(h)).not.toContain('segredo-de-teste');
  });

  it('GET devolve bytes e tipo; 404 vira null; erro 5xx lança; DELETE tolera 404', async () => {
    const mk = (status: number, body?: BodyInit) => new S3BlobStore(cfg, (async () => new Response(body ?? null, { status, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch, fixed);
    const got = await mk(200, new Uint8Array([9, 8])).get('k');
    expect([...got!.bytes]).toEqual([9, 8]);
    expect(got!.contentType).toBe('image/png');
    expect(await mk(404).get('k')).toBeNull();
    await expect(mk(500).get('k')).rejects.toThrow(/S3 GET falhou: 500/);
    await expect(mk(403).put('k', new Uint8Array([1]), 'image/png')).rejects.toThrow(/S3 PUT falhou: 403/);
    await expect(mk(404).delete('k')).resolves.toBeUndefined();
    await expect(mk(500).delete('k')).rejects.toThrow();
  });

  it('getBlobStore só existe com a configuração completa e endpoint http(s)', () => {
    expect(getBlobStore({})).toBeNull();
    expect(getBlobStore({ S3_ENDPOINT: 'https://x', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a' })).toBeNull();
    expect(getBlobStore({ S3_ENDPOINT: 'ftp://x', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' })).toBeNull();
    expect(getBlobStore({ S3_ENDPOINT: 'https://x', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' })).toBeInstanceOf(S3BlobStore);
  });
});
