/**
 * Shadow AO VIVO (Diretiva V3 §14; parecer QA 3 M2, achado 4). Liga-se ao coletor do Editorial sem mudar o que ele recebe:
 *  - `wrap(primary)`: devolve um leitor no formato do coletor que SEMPRE responde com o resultado do caminho atual (`primary`);
 *    em segundo plano o `AdaptiveRouter` lê a mesma URL e só a COMPARAÇÃO é gravada.
 *  - `observe(url, outcome)`: para as fontes que o coletor lê direto (sem leitor), registra o resultado atual e dispara a sombra.
 * Regras (PM, 23/11): só medir; nada publicado nem gravado como matéria (só status, tamanho, hash, latência, créditos, provedor);
 * desligado se `SCRAPING_SHADOW_MODE` != "true"; fila com concorrência 1 e teto de URLs por execução; erros da sombra são engolidos
 * e nunca chegam ao coletor; o orçamento/corte é o do roteador (`BudgetGuard`).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { challengeReason, stripHtml, type EditorialReaderPort, type EditorialReaderResult } from '@ln/intelligence';
import { REFUSAL_STATUS, type AdaptiveRouter } from './router';
import { readFlags } from './flags';
import { sha256, bodyEvidence, type BodyEvidence } from './quality';

export interface ShadowComparison {
  at: string;
  url: string;
  primary: { name: string; status: number; ok: boolean; bodyLength: number; hash?: string; ms: number; evidence?: BodyEvidence };
  shadow: { provider?: string; ok: boolean; failure?: string; textLength: number; hash?: string; ms: number; credits: number; steps: string[]; evidence?: BodyEvidence } | { error: string } | { skipped: 'ritmo' | 'recusa' };
  divergent: boolean;
}

export interface LiveShadowOptions {
  router: AdaptiveRouter;
  sinkPath?: string; // JSONL; sem caminho, só `onComparison`
  onComparison?: (c: ShadowComparison) => void;
  env?: Record<string, string | undefined>;
  maxUrlsPerRun?: number; // teto de leituras sombra por processo (padrão 200)
  now?: () => number;
  /** Antes de cada leitura sombra (ritmo por host): false = não lê (registra 'skipped'). */
  beforeShadow?: (url: string) => Promise<boolean>;
  /** Depois de cada comparação (ex.: suspender host após 429). */
  afterShadow?: (url: string, c: ShadowComparison) => void;
}

export class LiveShadow {
  private queue: Promise<void> = Promise.resolve();
  private count = 0;
  readonly enabled: boolean;
  constructor(private readonly o: LiveShadowOptions) {
    this.enabled = readFlags(o.env ?? process.env).SCRAPING_SHADOW_MODE;
  }
  private now() {
    return (this.o.now ?? Date.now)();
  }

  /** Envolve o leitor do coletor. Desligado = devolve o próprio `primary` (nenhum custo, nenhum efeito). */
  wrap<T extends EditorialReaderPort & { discover?: unknown }>(primary: T): T {
    if (!this.enabled) return primary;
    return {
      ...primary, // preserva discover e demais membros (pedido da Editorial)
      name: primary.name,
      unlocks: primary.unlocks,
      read: async (url: string): Promise<EditorialReaderResult> => {
        const t0 = this.now();
        const res = await primary.read(url);
        this.observe(url, { name: primary.name, status: res.status, body: res.body, ms: this.now() - t0 });
        return res; // o coletor recebe exatamente o resultado do caminho atual
      },
      ...(typeof primary.discover === 'function' ? { discover: (primary.discover as (...a: unknown[]) => unknown).bind(primary) } : {}),
    } as T;
  }

  /** Registra o resultado do caminho atual (corpo efêmero: só tamanho e hash) e agenda a leitura sombra. Nunca lança. */
  observe(url: string, primary: { name: string; status: number; body?: string; ms: number }): void {
    if (!this.enabled) return;
    if (this.count >= (this.o.maxUrlsPerRun ?? 200)) return;
    this.count++;
    const p = { name: primary.name, status: primary.status, ok: primary.status >= 200 && primary.status < 300 && (primary.body?.length ?? 0) > 0, bodyLength: primary.body?.length ?? 0, hash: primary.body ? sha256(primary.body) : undefined, ms: primary.ms, evidence: primary.body ? bodyEvidence(primary.body, /<\w+[\s>]/.test(primary.body) ? primary.body : undefined) : undefined };
    const refused = primary.status === 0 || primary.status === 429 || REFUSAL_STATUS.has(primary.status)
      || (!!primary.body && challengeReason({ status: primary.status, html: primary.body, text: stripHtml(primary.body) }) !== null);
    this.queue = this.queue.then(() => this.runShadow(url, p, refused)).catch(() => {}); // concorrência 1; erro não propaga
  }

  /** Espera a fila (para testes e encerramento do worker). */
  drain(): Promise<void> {
    return this.queue;
  }

  private async runShadow(url: string, p: ShadowComparison['primary'], refused: boolean): Promise<void> {
    let c: ShadowComparison;
    const skipped = refused ? 'recusa' : this.o.beforeShadow && !(await this.o.beforeShadow(url).catch(() => false)) ? 'ritmo' : null;
    if (skipped) {
      c = { at: new Date(this.now()).toISOString(), url, primary: p, shadow: { skipped }, divergent: false };
      if (this.o.sinkPath) {
        mkdirSync(dirname(this.o.sinkPath), { recursive: true });
        appendFileSync(this.o.sinkPath, JSON.stringify(c) + '\n');
      }
      this.o.onComparison?.(c);
      try {
        this.o.afterShadow?.(url, c); // o 429 do site continua suspendendo o host no ritmo da sombra
      } catch {
        /* gancho nunca derruba a fila */
      }
      return;
    }
    const t0 = this.now();
    try {
      const out = await this.o.router.route(url);
      const text = out.result?.ok ? (out.result.text ?? '') : '';
      const s = { provider: out.provider, ok: !!out.result?.ok, failure: out.result?.ok ? undefined : out.result?.failure, textLength: text.length, hash: text ? sha256(text) : undefined, ms: this.now() - t0, credits: out.creditsUsed, steps: out.decisions.map((d) => `${d.step}${d.provider ? ':' + d.provider : ''}`), evidence: out.result?.ok ? bodyEvidence(out.result.text, out.result.html) : undefined };
      c = { at: new Date(t0).toISOString(), url, primary: p, shadow: s, divergent: p.ok !== s.ok };
    } catch (e) {
      c = { at: new Date(t0).toISOString(), url, primary: p, shadow: { error: String((e as Error)?.message ?? e).slice(0, 200) }, divergent: true };
    }
    if (this.o.sinkPath) {
      mkdirSync(dirname(this.o.sinkPath), { recursive: true });
      appendFileSync(this.o.sinkPath, JSON.stringify(c) + '\n');
    }
    this.o.onComparison?.(c);
    try {
      this.o.afterShadow?.(url, c);
    } catch {
      /* gancho nunca derruba a fila */
    }
  }
}
