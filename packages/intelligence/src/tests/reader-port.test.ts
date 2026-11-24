import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_PACE, HostPacer, QuotaKeyPool, createReader, detectLoginOrPaywall, nextMonthStartUtc, toPersistableFact,
  type KeyConfig, type KeyedReader, type ProviderResponse, type ReaderDeps,
} from '../index';

/** Relógio controlável. */
const makeClock = (iso: string) => {
  let t = new Date(iso).getTime();
  return { now: () => new Date(t), advanceSeconds: (s: number) => { t += s * 1000; }, set: (i: string) => { t = new Date(i).getTime(); } };
};

const KEYS: KeyConfig[] = [
  { label: 'conta-1', secretRef: 'SEGREDO_1', monthlyCreditCap: 5000 },
  { label: 'conta-2', secretRef: 'SEGREDO_2', monthlyCreditCap: 5000 },
];
// Chaves FALSAS montadas em tempo de execução (nenhum literal com cara de chave no arquivo): visivelmente falsas e sem disfarce.
const SECRETS: Record<string, string> = { SEGREDO_1: 'sk-' + 'A'.repeat(32), SEGREDO_2: 'sk-' + 'B'.repeat(32) };

const longText = 'Conteúdo público da página com texto legítimo suficiente para parecer uma notícia. '.repeat(30);
const ok = (extra: Partial<ProviderResponse> = {}): ProviderResponse => ({ status: 'ok', credits: 1, httpStatus: 200, text: longText, ...extra });

function setup(handler: (apiKey: string, n: number) => ProviderResponse, opts: { keys?: KeyConfig[]; enabled?: boolean; clockIso?: string; creditsPerRead?: number } = {}) {
  const clock = makeClock(opts.clockIso ?? '2026-11-23T12:00:00Z');
  let n = 0;
  const calls: string[] = [];
  const keyed: KeyedReader = {
    provider: 'provedor-x',
    creditsPerRead: opts.creditsPerRead ?? 1,
    read: vi.fn(async (_req, apiKey: string) => { calls.push(apiKey); return handler(apiKey, ++n); }),
  };
  const deps: ReaderDeps = { keyed, keys: opts.keys ?? KEYS, resolveSecret: (ref) => SECRETS[ref], clock };
  const reader = createReader(deps, { enabled: opts.enabled ?? true });
  return { reader, keyed, calls, clock };
}

describe('leitor por provedor: desligado por padrão', () => {
  it('sem enabled:true nada é chamado e o resultado é "disabled"', async () => {
    const t = setup(() => ok(), { enabled: false });
    const r = await t.reader.read({ url: 'https://exemplo.invalid/a' });
    expect(r).toMatchObject({ ok: false, failure: 'disabled', provider: 'provedor-x' });
    expect(t.keyed.read).not.toHaveBeenCalled();
    // e nem com config omitida
    const d = createReader({ keyed: t.keyed, keys: KEYS, resolveSecret: (ref) => SECRETS[ref] });
    expect((await d.read({ url: 'https://exemplo.invalid/a' })).failure).toBe('disabled');
    expect(t.keyed.read).not.toHaveBeenCalled();
  });
});

describe('duas contas por provedor: troca automática quando a cota gratuita acaba', () => {
  it('usa a primeira conta; quando o provedor diz "cota esgotada", troca para a segunda na MESMA leitura e lembra', async () => {
    const t = setup((key) => (key === SECRETS.SEGREDO_1 ? { status: 'quota_exhausted', httpStatus: 402 } : ok()));
    const r1 = await t.reader.read({ url: 'https://a.invalid/1' });
    expect(r1).toMatchObject({ ok: true, keyLabel: 'conta-2', creditsUsed: 1 });
    expect(t.calls).toEqual([SECRETS.SEGREDO_1, SECRETS.SEGREDO_2]); // tentou a 1, trocou para a 2

    t.clock.advanceSeconds(11); // ritmo por host
    const r2 = await t.reader.read({ url: 'https://a.invalid/2' });
    expect(r2).toMatchObject({ ok: true, keyLabel: 'conta-2' });
    expect(t.calls).toHaveLength(3); // a conta-1 esgotada NÃO é chamada de novo
  });

  it('as duas esgotadas: falha "quota_exhausted" sem chamar o provedor e sem comprar nada; renova no dia 1 do mês seguinte', async () => {
    const t = setup(() => ({ status: 'quota_exhausted', httpStatus: 402 }), { clockIso: '2026-11-23T12:00:00Z' });
    const r = await t.reader.read({ url: 'https://a.invalid/1' });
    expect(r).toMatchObject({ ok: false, failure: 'quota_exhausted' });
    expect(t.calls).toHaveLength(2);

    t.clock.advanceSeconds(11);
    const again = await t.reader.read({ url: 'https://a.invalid/2' });
    expect(again.failure).toBe('quota_exhausted');
    expect(t.calls).toHaveLength(2); // nenhuma chamada nova enquanto esgotadas

    t.clock.set('2026-12-01T00:00:01Z'); // renovou
    expect(nextMonthStartUtc(new Date('2026-11-23T12:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    const ok3 = createReader({ keyed: { provider: 'p', creditsPerRead: 1, read: async () => ok() }, keys: KEYS, resolveSecret: (r) => SECRETS[r], clock: t.clock }, { enabled: true });
    expect((await ok3.read({ url: 'https://a.invalid/3' })).ok).toBe(true);
  });

  it('teto local por chave = cota gratuita: nunca passa dele (nada pago); sem saldo local troca de chave sem chamar', async () => {
    const keys: KeyConfig[] = [
      { label: 'conta-1', secretRef: 'SEGREDO_1', monthlyCreditCap: 2 },
      { label: 'conta-2', secretRef: 'SEGREDO_2', monthlyCreditCap: 1 },
    ];
    const t = setup(() => ok(), { keys });
    const hosts = ['a', 'b', 'c', 'd'];
    const out = [];
    for (const h of hosts) out.push(await t.reader.read({ url: `https://${h}.invalid/x` }));
    expect(out.map((r) => r.keyLabel ?? r.failure)).toEqual(['conta-1', 'conta-1', 'conta-2', 'quota_exhausted']);
    expect(t.calls).toHaveLength(3); // a 4ª leitura nem chega ao provedor
  });

  it('limite de taxa do provedor (429) = espera na chave, não esgotamento; usa a outra chave e a primeira volta depois', async () => {
    const t = setup((key, n) => (key === SECRETS.SEGREDO_1 && n === 1 ? { status: 'rate_limited', retryAfterSeconds: 60, httpStatus: 429 } : ok()));
    const r = await t.reader.read({ url: 'https://a.invalid/1' });
    expect(r).toMatchObject({ ok: true, keyLabel: 'conta-2' });
    t.clock.advanceSeconds(61);
    const r2 = await t.reader.read({ url: 'https://a.invalid/2' });
    expect(r2.keyLabel).toBe('conta-1'); // voltou depois da espera
  });

  it('todas as chaves em espera de taxa: falha "rate_limited" com o tempo a esperar', async () => {
    const t = setup(() => ({ status: 'rate_limited', retryAfterSeconds: 45, httpStatus: 429 }));
    const r = await t.reader.read({ url: 'https://a.invalid/1' });
    expect(r).toMatchObject({ ok: false, failure: 'rate_limited', retryAfterSeconds: 45 });
  });

  it('o segredo nunca aparece no resultado nem no relatório do pool; só o rótulo', async () => {
    const t = setup(() => ok());
    const r = await t.reader.read({ url: 'https://a.invalid/1' });
    const pool = (t.reader as unknown as { pool: QuotaKeyPool }).pool;
    const all = JSON.stringify([{ ...r, text: undefined }, pool.report()]);
    for (const v of Object.values(SECRETS)) expect(all).not.toContain(v);
    expect(all).toContain('conta-1');
  });

  it('chave sem segredo configurado é pulada; pool exige chave, rótulos únicos e teto positivo', async () => {
    const t = setup(() => ok(), { keys: [{ label: 'sem', secretRef: 'NAO_EXISTE', monthlyCreditCap: 10 }, ...KEYS] });
    expect((await t.reader.read({ url: 'https://a.invalid/1' })).keyLabel).toBe('conta-1');
    const clock = makeClock('2026-11-23T00:00:00Z');
    expect(() => new QuotaKeyPool([], clock)).toThrow();
    expect(() => new QuotaKeyPool([KEYS[0]!, KEYS[0]!], clock)).toThrow(/repetidos/);
    expect(() => new QuotaKeyPool([{ label: 'x', secretRef: 'y', monthlyCreditCap: 0 }], clock)).toThrow(/teto/);
  });
});

describe('ritmo baixo por host (DP-32 mantém)', () => {
  it('mesmo host antes de 10 s é recusado sem chamar; outro host passa; depois de 10 s passa', async () => {
    const t = setup(() => ok());
    expect((await t.reader.read({ url: 'https://um.invalid/a' })).ok).toBe(true);
    const r = await t.reader.read({ url: 'https://um.invalid/b' });
    expect(r).toMatchObject({ ok: false, failure: 'host_paced' });
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(10);
    expect(t.calls).toHaveLength(1);
    expect((await t.reader.read({ url: 'https://dois.invalid/a' })).ok).toBe(true);
    t.clock.advanceSeconds(10);
    expect((await t.reader.read({ url: 'https://um.invalid/b' })).ok).toBe(true);
  });

  it('teto de leituras por host por dia (poucas páginas por dia) e URL inválida', async () => {
    const clock = makeClock('2026-11-23T08:00:00Z');
    const pacer = new HostPacer(clock, { minSecondsPerHost: 10, maxPerHostPerDay: 3 });
    for (let i = 0; i < 3; i++) { expect(pacer.check('h')).toBeNull(); pacer.record('h'); clock.advanceSeconds(11); }
    expect(pacer.check('h')).toBe(Infinity); // estourou o dia
    clock.set('2026-11-24T08:00:00Z');
    expect(pacer.check('h')).toBeNull(); // dia seguinte
    expect(DEFAULT_PACE).toMatchObject({ minSecondsPerHost: 10 });
    const t = setup(() => ok());
    expect((await t.reader.read({ url: 'não é url' })).failure).toBe('provider_error');
    expect((await t.reader.read({ url: 'ftp://x.invalid/a' })).failure).toBe('provider_error');
  });
});

describe('login e paywall continuam parando; CAPTCHA resolvido pelo provedor não', () => {
  it('tela de login (formulário de senha em página curta) e paywall viram falha e o texto é descartado', async () => {
    const login = setup(() => ({ status: 'ok', credits: 1, httpStatus: 200, html: '<form><input type="password" name="p"></form>', text: 'Entrar Senha' }));
    const r1 = await login.reader.read({ url: 'https://a.invalid/area' });
    expect(r1).toMatchObject({ ok: false, failure: 'login_required' });
    expect(r1.text).toBeUndefined();

    const pay = setup(() => ({ status: 'ok', credits: 1, httpStatus: 200, text: `${longText} Conteúdo exclusivo para assinantes. Assine para continuar lendo.` }));
    const r2 = await pay.reader.read({ url: 'https://a.invalid/materia' });
    expect(r2).toMatchObject({ ok: false, failure: 'paywall' });
    expect(r2.text).toBeUndefined();

    const s401 = setup(() => ({ status: 'ok', credits: 1, httpStatus: 401, text: 'x' }));
    expect((await s401.reader.read({ url: 'https://a.invalid/p' })).failure).toBe('login_required');
    const s402 = setup(() => ({ status: 'ok', credits: 1, httpStatus: 402, text: 'x' }));
    expect((await s402.reader.read({ url: 'https://b.invalid/p' })).failure).toBe('paywall');
    // o crédito gasto continua contado mesmo quando o conteúdo é descartado
    expect(r1.creditsUsed).toBe(1);
  });

  it('página longa com campo de senha no rodapé NÃO é tela de login', () => {
    expect(detectLoginOrPaywall({ html: `<footer><input type="password"></footer>`, text: longText.repeat(3) })).toBeNull();
    expect(detectLoginOrPaywall({ text: 'Faça login para continuar lendo.' })).toBe('login_required');
    expect(detectLoginOrPaywall({ text: longText })).toBeNull();
  });

  it('reportagem longa que CITA o aviso de paywall NÃO é descartada; aviso no topo de página longa, página curta e 401/402 continuam parando (ressalva R2 do QA 1)', async () => {
    const cita = 'O jornal exibe "assine para continuar lendo" a quem não é assinante. ';
    const longa = longText.repeat(4) + cita + longText.repeat(2); // o aviso aparece DEPOIS dos 1.500 primeiros caracteres
    expect(longa.length).toBeGreaterThan(3000);
    expect(longa.indexOf('assine para continuar lendo')).toBeGreaterThan(1500);
    expect(detectLoginOrPaywall({ text: longa })).toBeNull();
    expect(detectLoginOrPaywall({ text: longa, html: '<p>' + longa + '</p>' })).toBeNull();
    // aviso real: página curta, ou no começo de página longa
    expect(detectLoginOrPaywall({ text: 'Conteúdo exclusivo para assinantes.' })).toBe('paywall');
    expect(detectLoginOrPaywall({ text: 'Assine para continuar lendo. ' + longText.repeat(4) })).toBe('paywall');
    expect(longText.length + cita.length).toBeLessThanOrEqual(3000);
    expect(detectLoginOrPaywall({ text: longText + cita })).toBe('paywall'); // ainda curta (<= 3.000): checagem completa
    // 401/402 valem sempre, mesmo com texto longo
    expect(detectLoginOrPaywall({ text: longa, httpStatus: 402 })).toBe('paywall');
    expect(detectLoginOrPaywall({ text: longa, httpStatus: 401 })).toBe('login_required');
    // pelo PooledReader: a leitura da reportagem longa que cita o aviso é entregue (ok), não descartada
    const s = setup(() => ok({ text: longa }));
    const r = await s.reader.read({ url: 'https://c.invalid/reportagem' });
    expect(r.ok).toBe(true);
    expect(r.failure).toBeUndefined();
  });

  it('R4 (QA 3): em página longa, aviso de paywall que só existe no HTML (overlay/modal/elemento de paywall) continua parando; reportagem que cita o aviso no meio do corpo, não', () => {
    const corpo = longText.repeat(2); // ~4.800 caracteres de texto, sem aviso
    expect(corpo.length).toBeGreaterThan(3000);
    // overlay no FIM do HTML (class com "paywall"): o texto extraído não o traz
    expect(detectLoginOrPaywall({ text: corpo, html: `<article>${corpo}</article><div class="site-paywall"><p>Conteúdo exclusivo para assinantes</p></div>` })).toBe('paywall');
    // modal por id, com o aviso dentro de um aside/dialog
    expect(detectLoginOrPaywall({ text: corpo, html: `<main>${corpo}</main><dialog id="subscribe-modal">Assine para continuar lendo</dialog>` })).toBe('paywall');
    // aviso no início do texto VISÍVEL do HTML (sem class de paywall), com texto extraído sem ele
    expect(detectLoginOrPaywall({ text: corpo, html: `<body><p>Assine para continuar lendo</p><article>${corpo}</article></body>` })).toBe('paywall');
    // aviso só dentro de <script>/<style> não conta como texto visível
    expect(detectLoginOrPaywall({ text: corpo, html: `<script>var t="Assine para continuar lendo";</script><article>${corpo}</article>` })).toBeNull();
    // a reportagem que CITA o aviso no meio do corpo (em parágrafo comum) continua liberada, com ou sem HTML
    const cita = corpo + ' O jornal exibe "assine para continuar lendo" a quem não é assinante. ' + corpo;
    expect(detectLoginOrPaywall({ text: cita, html: `<article><p>${cita}</p></article><div class="comments">${longText}</div>` })).toBeNull();
    // 401/402 e página curta seguem como antes
    expect(detectLoginOrPaywall({ text: 'Conteúdo exclusivo para assinantes.' })).toBe('paywall');
    expect(detectLoginOrPaywall({ text: corpo, httpStatus: 402 })).toBe('paywall');
  });

  it('R5 (QA 3, ee01f58): marcador de overlay é TOKEN de class/id, não substring; gate/wall só com qualificador; wrapper do corpo, gateway e firewall não', () => {
    const corpo = 'Conteudo publico da pagina com texto legitimo suficiente para parecer uma noticia. '.repeat(40);
    const cita = corpo + ' O jornal exibe "assine para continuar lendo" a quem nao e assinante. ' + corpo;
    expect(cita.length).toBeGreaterThan(6000);
    const aviso = '<p>Conteudo exclusivo para assinantes</p>';
    const fim = (cls: string) => detectLoginOrPaywall({ text: corpo, html: `<article>${corpo}</article><div class="${cls}">${aviso}</div>` });
    // overlay curto no fim: fortes sozinhos (com hífen/sublinhado/maiúscula) e prefixos de subscribe/assinante; fracos (gate/wall) só com qualificador no mesmo atributo
    for (const cls of ['content-gate', 'pay-wall', 'member_wall', 'article gate', 'tp-holder', 'site_paywall', 'regwall', 'Overlay', 'subscriber_modal', 'assinante-box', 'subscription-box', 'premium-barrier']) {
      expect(fim(cls), cls).toBe('paywall');
    }
    expect(detectLoginOrPaywall({ text: corpo, html: `<article>${corpo}</article><section id="paywall">${'chamada do plano. '.repeat(300)}<b>Conteudo exclusivo para assinantes</b></section>` })).toBe('paywall'); // 5.400 caracteres do próprio elemento
    // NÃO são marcadores: gateway, firewall, aggregate, lock, corpo, e gate/wall SOZINHOS (sem qualificador)
    for (const cls of ['gateway', 'news-firewall', 'aggregate-wrapper', 'lock', 'article-body', 'paywallish-not', 'gate', 'wall', 'wall-street']) {
      expect(fim(cls), cls).toBeNull();
    }
    // G9: wrapper "gateway" em volta da matéria que cita o aviso: passa. G7: wrapper "wall" isolado com o corpo: passa (gate/wall precisam de qualificador)
    expect(detectLoginOrPaywall({ text: cita, html: `<div class="gateway"><p>${cita}</p></div>` })).toBeNull();
    expect(detectLoginOrPaywall({ text: cita, html: `<div class="wall"><p>${cita}</p></div>` })).toBeNull();
    expect(detectLoginOrPaywall({ text: cita, html: `<div class="article-body"><p>${cita}</p></div>` })).toBeNull();
    expect(detectLoginOrPaywall({ text: cita, html: `<article><p>${cita}</p></article>` })).toBeNull();
    // aviso fora da janela de 6.000 caracteres do próprio elemento (7.500): fica de fora
    expect(detectLoginOrPaywall({ text: corpo, html: `<section id="paywall">${'chamada do plano. '.repeat(420)}<b>Conteudo exclusivo para assinantes</b></section>` })).toBeNull();
    // página curta: checagem completa, com ou sem marcador
    expect(detectLoginOrPaywall({ text: 'texto curto', html: '<div class="gate">Conteudo exclusivo para assinantes</div>' })).toBe('paywall');
    expect(detectLoginOrPaywall({ text: corpo, httpStatus: 401 })).toBe('login_required');
    // class e id na mesma tag, aspas simples, atributos antes/depois
    expect(detectLoginOrPaywall({ text: corpo, html: `<article>${corpo}</article><div data-x="1" id='main' class='box content-gate' hidden>${aviso}</div>` })).toBe('paywall');
  });

  it('desafio resolvido pelo próprio provedor NÃO para a leitura (DP-32); desafio devolvido sem resolver é falha', async () => {
    const solved = setup(() => ok({ providerSolvedCaptcha: true }));
    const r = await solved.reader.read({ url: 'https://a.invalid/1' });
    expect(r).toMatchObject({ ok: true, providerSolvedCaptcha: true });
    expect(r.text).toBe(longText);

    const unsolved = setup(() => ({ status: 'captcha_unsolved', credits: 1, httpStatus: 200 }));
    const f = await unsolved.reader.read({ url: 'https://a.invalid/2' });
    expect(f).toMatchObject({ ok: false, failure: 'captcha_unsolved' });
    expect(f.text).toBeUndefined();
  });

  it('não-encontrado, tempo esgotado e erro do provedor são falhas sem troca de chave nem texto', async () => {
    for (const status of ['not_found', 'timeout', 'provider_error'] as const) {
      const t = setup(() => ({ status, credits: 0, httpStatus: 500 }));
      const r = await t.reader.read({ url: 'https://a.invalid/1' });
      expect(r).toMatchObject({ ok: false, failure: status });
      expect(t.calls).toHaveLength(1);
    }
  });
});

describe('só fato, fonte, link e data (DP-29): nada de texto integral', () => {
  const base = { fact: 'A empresa X anunciou parceria com a Y.', sourceName: 'Fonte Z', sourceUrl: 'https://z.invalid/p', retrievedAt: '2026-11-23T12:00:00Z' };

  it('aceita fato curto com fonte, link e data', () => {
    expect(toPersistableFact({ ...base, provider: 'firecrawl' })).toEqual({ ...base, provider: 'firecrawl' });
  });

  it('recusa texto longo, campos de corpo de página, link inválido e data inválida', () => {
    expect(() => toPersistableFact({ ...base, fact: 'x'.repeat(301) })).toThrow(/nunca texto integral/);
    expect(() => toPersistableFact({ ...base, text: longText })).toThrow(/corpo de página/);
    expect(() => toPersistableFact({ ...base, html: '<p>x</p>' })).toThrow(/corpo de página/);
    expect(() => toPersistableFact({ ...base, markdown: '# x' })).toThrow(/corpo de página/);
    expect(() => toPersistableFact({ ...base, sourceUrl: 'javascript:alert(1)' })).toThrow(/sourceUrl/);
    expect(() => toPersistableFact({ ...base, retrievedAt: 'ontem' })).toThrow(/retrievedAt/);
    expect(() => toPersistableFact({ ...base, fact: '   ' })).toThrow();
  });
});
