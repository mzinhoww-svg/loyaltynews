import { describe, it, expect, vi } from 'vitest';
import { BRIGHTDATA_STAGING, READER_FLAG, createBrightDataStagingReader, createReaderViaFlag, type KeyedReader, type ProviderResponse, type ReaderDeps } from '../index';

// Chave FALSA montada em tempo de execução (nenhum literal com cara de chave).
const FAKE = 'sk-' + 'Z'.repeat(32);
const HTML = '<html><body>' + 'Diretoria e administração da companhia. '.repeat(30) + '</body></html>';
const okBody = () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });

function fakeKeyed() {
  const read = vi.fn(async (): Promise<ProviderResponse> => ({ status: 'ok', credits: 1, httpStatus: 200, text: 'Texto de página pública suficientemente longo. '.repeat(10) }));
  const keyed: KeyedReader = { provider: 'fake', creditsPerRead: 1, read };
  const deps: ReaderDeps = { keyed, keys: [{ label: 'conta-1', secretRef: 'K', monthlyCreditCap: 100 }], resolveSecret: () => FAKE, robots: async () => ({ allowed: true, note: 'MOCK: robots permite' }) };
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

  it('ADR-007: mesmo com a flag ligada, o Web Unlocker (desbloqueio) é recusado: nenhuma chamada, nenhum crédito', async () => {
    const fetchImpl = vi.fn(async () => okBody());
    const r = createBrightDataStagingReader(() => FAKE, () => true, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
    for (const u of ['https://ri.exemplo.invalid/a', 'https://ri.exemplo.invalid/b']) expect(await r.read({ url: u })).toMatchObject({ ok: false, failure: 'unlock_forbidden', provider: 'brightdata-unlocker' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.pool!.report().map((x) => [x.label, x.usedInMonth])).toEqual([['conta-2', 0]]);
  });

  it('sem o segredo configurado a leitura não chama o provedor e não inventa outra conta', async () => {
    const fetchImpl = vi.fn(async () => okBody());
    const r = createBrightDataStagingReader(() => undefined, () => true, { fetchImpl: fetchImpl as unknown as typeof fetch, pace: false });
    expect((await r.read({ url: 'https://ri.exemplo.invalid/a' })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
