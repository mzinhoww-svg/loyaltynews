import { PAUTA_PROCESSED, readPautas } from '../api/pauta-handlers';
import { runAutoral } from './autoral';
import type { FactoryDeps } from './run';

/**
 * Worker da pauta autoral: processa as pautas PENDENTES (registradas por POST /pautas) uma a uma, no máximo `max` por execução, e
 * grava `pauta.processed` com o resultado. Termina cada matéria em `aprovado` ou `bloqueado`; não emite recibo nem publica.
 * Falha de flag desligada ou de infraestrutura SOBE (a pauta continua pendente); resultado de negócio (bloqueada, âncora ausente) é gravado.
 */
export interface AutoralQueueReport { processed: Array<{ id: string; status: string; articleId: string | null }>; pending: number }

export async function runAutoralQueue(deps: FactoryDeps, opts: { max?: number } = {}): Promise<AutoralQueueReport> {
  const now = deps.now ?? (() => new Date());
  const pending = (await readPautas(deps.store)).filter((p) => p.estado === 'pendente').reverse(); // mais antigas primeiro
  const report: AutoralQueueReport = { processed: [], pending: pending.length };
  for (const p of pending.slice(0, opts.max ?? 3)) {
    const row = await runAutoral(deps, { id: p.id, titulo: p.titulo, angulo: p.angulo, formato: p.formato, editoria: p.editoria, ancoras: p.ancoras });
    await deps.store.appendAudit({
      at: now().toISOString(), userId: null, action: PAUTA_PROCESSED, target: p.id,
      detail: JSON.stringify({ status: row.status, articleId: row.articleId, blockers: row.blockers, findings: row.findings.slice(0, 5) }),
    });
    report.processed.push({ id: p.id, status: row.status, articleId: row.articleId });
  }
  report.pending = Math.max(pending.length - report.processed.length, 0);
  return report;
}
