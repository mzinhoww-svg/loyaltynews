import { describe, it, expect, vi } from 'vitest';
import { BRIGHTDATA_STAGING, READER_FLAG, createBrightDataStagingReader, createReaderViaFlag, type KeyedReader, type ProviderResponse, type ReaderDeps } from '../index';

// Chave FALSA montada em tempo de execução (nenhum literal com cara de chave).
const FAKE = 'sk-' + 'Z'.repeat(32);
const HTML = '<html><body>' + 'Diretoria e administração da companhia. '.repeat(30) + '</body></html>';
const okBody = () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });

function fakeKeyed() {
  const read = vi.fn(async (): Promise<ProviderResponse> => ({ status: 'ok', credits: 1, httpStatus: 200, text: 'Texto de página pública suficientemente longo. '.repeat(10) }));
  const keyed: KeyedReader = { provider: 'fake', creditsPerRead: 1, read };
  const deps: ReaderDeps = { keyed, keys: [{ label: 'conta-1', secretRef: 'K', monthlyCreditCap: 100 }], resolveSecret: () => FAKE };
  return { read, deps };
}

describe('leitor por provedor: nasce DESLIGADO e só liga pelo resolvedor (ADR-022, adendo 2)', () => {
  it('o nome da flag é leitorViaProvedor', () => {
    expect(READER_FLAG).toBe('leitorViaProvedor');
  });

  it('sem resolvedor: desligado, nada é chamado e nenhum leitor interno é criado', async () => {
    const { read, deps } = fakeKeyed();
    const r = createReaderViaFlag(deps);
    expect(r.isOn()).toBe(false);
    expect(await r.read({ url: 'https://a.invalid/x' })).toMatchObject({ ok: false, failure: 'disabled', provider: 'fake' });
    expect(read).not.toHaveBeenCalled();
    expect(r.pool).toBeUndefined();
  });

  it('resolvedor que devolve false, algo que não é true ou LANÇA: desligado (falha fechada); nunca chama o provedor', async () => {
    const { read, deps } = fakeKeyed();
    const casos: Record<string, () => boolean> = {
      falso: () => false,
      'truthy que não é true': (() => 1) as unknown as () => boolean,
      indefinido: (() => undefined) as unknown as () => boolean,
      lança: () => { throw new Error('flags indisponíveis'); },
    };
    for (const [nome, resolve] of Object.entries(casos)) {
      const r = createReaderViaFlag(deps, resolve);
      expect(r.isOn(), nome).toBe(false);
      expect((await r.read({ url: 'https://a.invalid/x' })).failure, nome).toBe('disabled');
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('o resolvedor é perguntado com o nome da flag e a cada leitura: liga e desliga ao vivo', async () => {
    const { read, deps } = fakeKeyed();
    let on = false;
    const resolve = vi.fn((flag: string) => flag === 'leitorViaProvedor' && on);
    const r = createReaderViaFlag(deps, resolve, { pace: false });
    expect((await r.read({ url: 'https://a.invalid/1' })).failure).toBe('disabled');
    on = true;
    const ok = await r.read({ url: 'https://a.invalid/2' });
    expect(ok).toMatchObject({ ok: true, keyLabel: 'conta-1' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(r.pool).toBeDefined();
    on = false;
    expect((await r.read({ url: 'https://a.invalid/3' })).failure).toBe('disabled');
    expect(read).toHaveBeenCalledTimes(1); // desligar volta a parar tudo
    expect(resolve).toHaveBeenCalledWith('leitorViaProvedor');
    expect(JSON.stringify([ok, r.pool!.report()])).not.toContain(FAKE); // segredo nunca no resultado
  });
});

describe('staging (DP-36): Bright Data com UMA conta, zone web_unlocker1, sem troca', () => {
  it('configuração: uma entrada conta-2 / BRIGHTDATA_API_KEY / teto 5000 e a zone web_unlocker1', () => {
    expect(BRIGHTDATA_STAGING.zone).toBe('web_unlocker1');
    expect(BRIGHTDATA_STAGING.keys).toEqual([{ label: 'conta-2', secretRef: 'BRIGHTDATA_API_KEY', monthlyCreditCap: 5000 }]);
    expect(Object.isFrozen(BRIGHTDATA_STAGING)).toBe(true);
  });

  it('com a flag DESLIGADA nenhum fetch acontece (nem para a Bright Data), mesmo com a chave disponível', async () => {
    const fetchImpl = vi.fn(async () => okBody());
    const r = createBrightDataStagingReader((ref) => (ref === 'BRIGHTDATA_API_KEY' ? FAKE : undefined), () => false, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
    expect((await r.read({ url: 'https://ri.exemplo.invalid/diretoria' })).failure).toBe('disabled');
    expect(createBrightDataStagingReader(() => FAKE, undefined, { fetchImpl: fetchImpl as unknown as typeof fetch }).isOn()).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('com a flag ligada: usa a zone web_unlocker1 e a chave só no cabeçalho da chamada; resultado traz só o rótulo conta-2', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return okBody(); });
    const r = createBrightDataStagingReader((ref) => (ref === 'BRIGHTDATA_API_KEY' ? FAKE : undefined), () => true, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
    const res = await r.read({ url: 'https://ri.exemplo.invalid/diretoria' });
    expect(res).toMatchObject({ ok: true, keyLabel: 'conta-2', provider: 'brightdata-unlocker' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.brightdata.com/request');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ zone: 'web_unlocker1', url: 'https://ri.exemplo.invalid/diretoria' });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${FAKE}`);
    expect(JSON.stringify([{ ...res, text: undefined, html: undefined }, r.pool!.report()])).not.toContain(FAKE);
    expect(r.pool!.report().map((x) => x.label)).toEqual(['conta-2']);
  });

  it('SEM TROCA de conta: cota acabou (402) ou chave recusada (401) = falha com UMA chamada; nenhuma segunda conta é tentada', async () => {
    for (const [status, failure] of [[402, 'quota_exhausted'], [401, 'auth_failed']] as const) {
      const fetchImpl = vi.fn(async () => new Response('x', { status }));
      const r = createBrightDataStagingReader(() => FAKE, () => true, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
      expect((await r.read({ url: 'https://ri.exemplo.invalid/a' })).failure).toBe(failure);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      // depois disso a conta única fica fora de uso: a próxima leitura nem chama o provedor
      const again = await r.read({ url: 'https://ri.exemplo.invalid/b' });
      expect(again.ok).toBe(false);
      expect(['quota_exhausted', 'auth_failed']).toContain(again.failure);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('o teto de 5000 créditos é da conta única: gasto o teto, a leitura falha por cota sem chamar o provedor (nunca paga)', async () => {
    const fetchImpl = vi.fn(async () => okBody());
    const r = createBrightDataStagingReader(() => FAKE, () => true, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
    await r.read({ url: 'https://ri.exemplo.invalid/0' });
    r.pool!.charge('conta-2', 4999); // 1 + 4999 = teto
    const res = await r.read({ url: 'https://ri.exemplo.invalid/1' });
    expect(res.failure).toBe('quota_exhausted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sem o segredo configurado a leitura não chama o provedor e não inventa outra conta', async () => {
    const fetchImpl = vi.fn(async () => okBody());
    const r = createBrightDataStagingReader(() => undefined, () => true, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
    expect((await r.read({ url: 'https://ri.exemplo.invalid/a' })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
