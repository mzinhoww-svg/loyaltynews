/**
 * Leitor por provedor LIGADO SÓ PELO RESOLVEDOR DE FLAGS (ADR-022, adendo 2; DP-32/DP-36).
 *
 * Regras:
 *  - A flag é `leitorViaProvedor` (default false; liberada só em staging pela DP-32; produção sem decisão). Quem monta o app injeta o resolvedor
 *    (`(flag) => isEnabled(flag, runtimeFlags())`); este módulo NUNCA lê variável de ambiente própria para ligar leitura (N1).
 *  - Sem resolvedor, com resolvedor que devolve false ou que LANÇA: desligado (falha fechada). Desligado = nenhum leitor externo é criado e nada chama `fetch`.
 *  - O resolvedor é consultado a CADA leitura (a flag vale no instante da chamada); o leitor interno só nasce na primeira leitura permitida.
 *  - ADR-007 (v8): o Web Unlocker é um serviço de desbloqueio, então a porta recusa a leitura ('unlock_forbidden') mesmo com a flag ligada.
 *  - Staging (DP-36): Bright Data com UMA conta (`conta-2`, `BRIGHTDATA_API_KEY`, teto 5000) e zone `web_unlocker1`, sem troca automática de conta:
 *    cota acabou ou chave recusada = falha (nunca outra conta, nunca compra). O valor da chave vem de `resolveSecret` só no instante da chamada.
 */
import { createReader, type KeyConfig, type ReaderConfig, type ReaderDeps, type ReaderPort, type ReadRequest, type ReadResult, type QuotaKeyPool } from '../reader-port';
import { BrightDataUnlockerReader } from './providers';

/** Nome da flag no contrato (`@ln/contracts` FLAG_DEFAULTS, por Backend 2). */
export const READER_FLAG = 'leitorViaProvedor' as const;
export type ReaderFlagResolver = (flag: typeof READER_FLAG) => boolean;

export interface FlaggedReader extends ReaderPort {
  /** Estado da flag AGORA (consulta o resolvedor; falha fechada). */
  isOn(): boolean;
  /** Pool do leitor interno; ausente enquanto a flag nunca esteve ligada. */
  readonly pool: QuotaKeyPool | undefined;
}

export function createReaderViaFlag(deps: ReaderDeps, resolve?: ReaderFlagResolver, config: Omit<ReaderConfig, 'enabled'> = {}): FlaggedReader {
  const provider = deps.keyed.provider;
  let inner: (ReaderPort & { pool?: QuotaKeyPool }) | undefined;
  const isOn = (): boolean => {
    if (!resolve) return false;
    try { return resolve(READER_FLAG) === true; } catch { return false; } // falha fechada
  };
  return {
    provider,
    isOn,
    get pool() { return inner?.pool; },
    async read(req: ReadRequest): Promise<ReadResult> {
      if (!isOn()) return { ok: false, url: req.url, provider, failure: 'disabled' };
      inner ??= createReader(deps, { ...config, enabled: true });
      return inner.read(req);
    },
  };
}

/** Staging (DP-36): UMA entrada da Bright Data, sem troca de conta. */
export const BRIGHTDATA_STAGING = Object.freeze({
  zone: 'web_unlocker1',
  keys: Object.freeze([{ label: 'conta-2', secretRef: 'BRIGHTDATA_API_KEY', monthlyCreditCap: 5000 }]) as readonly KeyConfig[],
});

/** Leitor da Bright Data para o staging, ligado só pelo resolvedor. `fetchImpl` é injetável (testes usam respostas simuladas). */
export function createBrightDataStagingReader(
  resolveSecret: (secretRef: string) => string | undefined,
  resolve?: ReaderFlagResolver,
  opts: { fetchImpl?: typeof fetch; pace?: ReaderConfig['pace']; clock?: ReaderDeps['clock'] } = {},
): FlaggedReader {
  return createReaderViaFlag(
    { keyed: new BrightDataUnlockerReader(BRIGHTDATA_STAGING.zone, opts.fetchImpl), keys: [...BRIGHTDATA_STAGING.keys], resolveSecret, clock: opts.clock },
    resolve,
    { pace: opts.pace },
  );
}
