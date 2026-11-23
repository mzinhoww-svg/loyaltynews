/**
 * Leitor de página PÚBLICA para a releitura agendada: 1) leitura direta (robots.txt RFC 9309 respeitado, redirecionamento NÃO seguido,
 * desafio/bloqueio detectado e nunca contornado, pausa entre requisições); 2) só se a direta falhar, o leitor por provedor injetado
 * (DP-32: página pública, sem login, ritmo baixo, cota gratuita). O texto devolvido é EFÊMERO: o chamador extrai o fato e descarta.
 */
import type { PageRead, PageReader } from '../reread';
import { fetchText, robotsAllows } from '../../scripts/verify-dataset.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createDirectPageReader(opts: { fallback?: PageReader; pauseMs?: number } = {}): PageReader {
  return async (url: string): Promise<PageRead> => {
    try {
      const rb = (await robotsAllows(url)) as { allowed: boolean; note: string };
      if (rb.allowed) {
        await sleep(opts.pauseMs ?? 1000);
        const f = (await fetchText(url)) as { estado: string; text: string; finalUrl: string; observacao?: string };
        if (f.estado === 'ok' && f.text.length >= 800) return { ok: true, text: f.text, finalUrl: f.finalUrl };
      }
    } catch { /* cai para o provedor, se houver */ }
    return opts.fallback ? opts.fallback(url) : { ok: false, failure: 'leitura direta recusada ou vazia e sem provedor' };
  };
}
