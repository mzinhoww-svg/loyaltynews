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
import type { EditorialReaderPort, EditorialReaderResult } from '@ln/intelligence';
import type { AdaptiveRouter } from './router';
import { readFlags } from './flags';
import { sha256 } from './quality';

export interface ShadowComparison {
  at: string;
  url: string;
  primary: { name: string; status: number; ok: boolean; bodyLength: number; hash?: string; ms: number };
  shadow: { provider?: string; ok: boolean; textLength: number; hash?: string; ms: number; credits: number; steps: string[] } | { error: string };
  divergent: boolean;
}

export interface LiveShadowOptions {
  router: AdaptiveRouter;
  sinkPath?: string; // JSONL; sem caminho, só `onComparison`
  onComparison?: (c: ShadowComparison) => void;
  env?: Record<string, string | undefined>;
  maxUrlsPerRun?: number; // teto de leituras sombra por processo (padrão 200)
  now?: () => number;
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
  wrap(primary: EditorialReaderPort): EditorialReaderPort {
    if (!this.enabled) return primary;
    return {
      name: primary.name,
      unlocks: primary.unlocks,
      read: async (url: string): Promise<EditorialReaderResult> => {
        const t0 = this.now();
        const res = await primary.read(url);
        this.observe(url, { name: primary.name, status: res.status, body: res.body, ms: this.now() - t0 });
        return res; // o coletor recebe exatamente o resultado do caminho atual
      },
    };
  }

  /** Registra o resultado do caminho atual (corpo efêmero: só tamanho e hash) e agenda a leitura sombra. Nunca lança. */
  observe(url: string, primary: { name: string; status: number; body?: string; ms: number }): void {
    if (!this.enabled) return;
    if (this.count >= (this.o.maxUrlsPerRun ?? 200)) return;
    this.count++;
    const p = { name: primary.name, status: primary.status, ok: primary.status >= 200 && primary.status < 300 && (primary.body?.length ?? 0) > 0, bodyLength: primary.body?.length ?? 0, hash: primary.body ? sha256(primary.body) : undefined, ms: primary.ms };
    this.queue = this.queue.then(() => this.runShadow(url, p)).catch(() => {}); // concorrência 1; erro não propaga
  }

  /** Espera a fila (para testes e encerramento do worker). */
  drain(): Promise<void> {
    return this.queue;
  }

  private async runShadow(url: string, p: ShadowComparison['primary']): Promise<void> {
    let c: ShadowComparison;
    const t0 = this.now();
    try {
      const out = await this.o.router.route(url);
      const text = out.result?.ok ? (out.result.text ?? '') : '';
      const s = { provider: out.provider, ok: !!out.result?.ok, textLength: text.length, hash: text ? sha256(text) : undefined, ms: this.now() - t0, credits: out.creditsUsed, steps: out.decisions.map((d) => `${d.step}${d.provider ? ':' + d.provider : ''}`) };
      c = { at: new Date(t0).toISOString(), url, primary: p, shadow: s, divergent: p.ok !== s.ok };
    } catch (e) {
      c = { at: new Date(t0).toISOString(), url, primary: p, shadow: { error: String((e as Error)?.message ?? e).slice(0, 200) }, divergent: true };
    }
    if (this.o.sinkPath) {
      mkdirSync(dirname(this.o.sinkPath), { recursive: true });
      appendFileSync(this.o.sinkPath, JSON.stringify(c) + '\n');
    }
    this.o.onComparison?.(c);
  }
}
