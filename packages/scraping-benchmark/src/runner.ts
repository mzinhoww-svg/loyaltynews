/**
 * Runner do benchmark (Experimento B). Uma tentativa por par URL × provedor, registrada individualmente em JSONL (checkpoint):
 * ao reiniciar, pares já gravados são pulados (idempotente). Concorrência 1; ritmo mínimo por host entre QUALQUER provedor.
 * Antes de cada chamada: flag, gate de cobrança e teto de créditos (BudgetGuard). Texto e HTML ficam só em memória.
 */
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReaderPort, ReadResult } from '@ln/intelligence';
import type { AttemptRecord, DatasetEntry, ErrorClass } from './types';
import type { BudgetGuard } from './budget';
import { evaluate, sameDate } from './quality';
import { isProviderDisabled } from './flags';

export interface BenchProvider {
  name: string;
  mode?: string;
  reader: ReaderPort;
  worstCaseCredits: number;
  mock?: boolean;
  /** Custo efetivo em US$ por chamada, quando o provedor informa (Scrapfly: cabeçalho; Apify: usageTotalUsd). */
  effectiveUsd?: (r: ReadResult) => number | null;
}

export interface RunnerOptions {
  experimentId: string;
  runId: string;
  codeVersion: string;
  outPath: string; // attempts.jsonl
  budget: BudgetGuard;
  minSecondsPerHost?: number;
  env?: Record<string, string | undefined>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (a: AttemptRecord) => void;
  maxAttempts?: number; // trava extra contra loops
}

const domainOf = (u: string) => new URL(u).hostname.replace(/^www\./, '');

export function classify(r: ReadResult, verdictReason: string): ErrorClass {
  if (r.ok) return verdictReason === 'ok' ? 'none' : verdictReason === 'captcha' ? 'captcha' : verdictReason === 'login_required' ? 'login_required' : verdictReason === 'paywall' ? 'paywall' : verdictReason === 'title_mismatch' ? 'title_mismatch' : 'empty_content';
  switch (r.failure) {
    case 'rate_limited':
      return 'http_429';
    case 'timeout':
      return 'timeout';
    case 'captcha_unsolved':
      return 'captcha';
    case 'login_required':
      return 'login_required';
    case 'paywall':
      return 'paywall';
    case 'quota_exhausted':
      return 'quota_exhausted';
    case 'auth_failed':
      return 'auth_failed';
    case 'disabled':
      return 'disabled';
    case 'not_found':
      return 'not_found';
    default:
      if (r.httpStatus === 403) return 'http_403';
      if (r.httpStatus === 429) return 'http_429';
      if (r.httpStatus && r.httpStatus >= 500) return 'http_5xx';
      if (r.httpStatus && r.httpStatus >= 400) return 'http_4xx';
      return 'provider_error';
  }
}

export function loadDone(outPath: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(outPath)) return done;
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const a = JSON.parse(line) as AttemptRecord;
      // pares bloqueados por orçamento/cobrança podem ser refeitos depois que o bloqueio sair
      if (a.errorClass !== 'budget_blocked' && a.errorClass !== 'billing_unconfirmed') done.add(`${a.runId}|${a.urlId}|${a.provider}`);
    } catch {
      /* linha corrompida: ignora, será refeita */
    }
  }
  return done;
}

export async function runBenchmark(dataset: DatasetEntry[], providers: BenchProvider[], o: RunnerOptions): Promise<AttemptRecord[]> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const gap = (o.minSecondsPerHost ?? 15) * 1000;
  const lastHit = new Map<string, number>();
  const done = loadDone(o.outPath);
  mkdirSync(dirname(o.outPath), { recursive: true });
  const out: AttemptRecord[] = [];
  let count = 0;

  // intercala provedores por URL, e URLs de hosts diferentes, para respeitar o ritmo sem ficar ocioso
  for (const p of providers) {
    for (const e of dataset) {
      const key = `${o.runId}|${e.id}|${p.name}`;
      if (done.has(key)) continue;
      if (o.maxAttempts !== undefined && count >= o.maxAttempts) return out;
      const base = {
        experimentId: o.experimentId,
        runId: o.runId,
        correlationId: randomUUID(),
        codeVersion: o.codeVersion,
        provider: p.name,
        mode: p.mode,
        urlId: e.id,
        url: e.url,
        domain: e.domain,
        mock: !!p.mock,
      };
      const skip = (errorClass: ErrorClass): AttemptRecord => ({ ...base, at: new Date(now()).toISOString(), durationMs: 0, technicalSuccess: false, editorialSuccess: false, errorClass, textLength: 0, creditsUsed: 0, costEstimatedUsd: 0, costEffectiveUsd: null, cacheState: 'bypass', retries: 0 });
      let rec: AttemptRecord;
      if (isProviderDisabled(p.name, o.env)) rec = skip('disabled');
      else {
        const b = p.name === 'direct' ? { ok: true as const } : o.budget.check(p.name, p.worstCaseCredits);
        if (!b.ok) rec = skip(b.reason);
        else {
          const host = domainOf(e.url);
          const wait = (lastHit.get(host) ?? 0) + gap - now();
          if (wait > 0) await sleep(wait);
          lastHit.set(host, now());
          const t0 = now();
          const r = await p.reader.read({ url: e.url, purpose: 'read' });
          const durationMs = now() - t0;
          const credits = r.creditsUsed ?? 0;
          if (credits && p.name !== 'direct') o.budget.record(p.name, credits);
          const v = evaluate(r.text, r.html, e.referenceTitle, r.httpStatus);
          const eff = p.effectiveUsd?.(r) ?? null;
          rec = {
            ...base,
            at: new Date(t0).toISOString(),
            finalUrl: r.finalUrl,
            httpStatus: r.httpStatus,
            durationMs,
            technicalSuccess: r.ok && (r.text?.trim().length ?? 0) > 0,
            editorialSuccess: r.ok && v.editorialSuccess,
            errorClass: classify(r, v.reason),
            title: v.meta.title?.slice(0, 300),
            author: v.meta.author?.slice(0, 120),
            publishedAt: v.meta.publishedAt,
            language: v.meta.language,
            textLength: v.textLength,
            contentHash: v.contentHash,
            snippet: v.snippet,
            titleMatch: +v.titleMatch.toFixed(3),
            sourceMatch: r.ok && r.finalUrl ? domainOf(r.finalUrl).endsWith(e.domain.split('.').slice(-2).join('.')) : undefined, // sem URL final: não verificável
            dateMatch: sameDate(v.meta.publishedAt, e.publishedAt),
            creditsUsed: credits,
            costEstimatedUsd: o.budget.estimateUsd(p.name, credits),
            costEffectiveUsd: eff,
            cacheState: 'miss',
            retries: 0,
          };
          count++;
        }
      }
      appendFileSync(o.outPath, JSON.stringify(rec) + '\n');
      o.onAttempt?.(rec);
      out.push(rec);
    }
  }
  return out;
}
