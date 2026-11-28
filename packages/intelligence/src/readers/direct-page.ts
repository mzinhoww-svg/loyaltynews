/**
 * Leitor de página PÚBLICA para a releitura agendada (ADR-007): 1) robots.txt (RFC 9309) respeitado: proíbe ou indisponível = nada é lido;
 * 2) leitura direta, sem seguir redirecionamento; recusa, desafio/CAPTCHA, erro HTTP ou de rede NUNCA viram leitura por provedor;
 * 3) a reserva por provedor só é chamada quando a página foi permitida e respondeu normalmente, mas com texto curto (depende de JavaScript).
 * O texto devolvido é EFÊMERO: o chamador extrai o fato e descarta.
 */
import type { PageRead, PageReader } from '../reread';
import { fetchText, robotsAllows } from '../../scripts/verify-dataset.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createDirectPageReader(opts: { fallback?: PageReader; pauseMs?: number; fetchImpl?: typeof fetch } = {}): PageReader {
  return async (url: string): Promise<PageRead> => {
    const fetchImpl = opts.fetchImpl ?? fetch;
    try {
      const rb = await robotsAllows(url, fetchImpl);
      if (!rb.allowed) return { ok: false, failure: rb.note };
      await sleep(opts.pauseMs ?? 1000);
      const f = await fetchText(url, fetchImpl);
      if (f.estado !== 'ok') return { ok: false, failure: `leitura direta ${f.estado} (HTTP ${f.status}): sem reserva por provedor` };
      if (f.text.length >= 800) return { ok: true, text: f.text, finalUrl: f.finalUrl };
    } catch {
      return { ok: false, failure: 'leitura direta falhou: sem reserva por provedor' };
    }
    return opts.fallback ? opts.fallback(url) : { ok: false, failure: 'leitura direta vazia e sem provedor' };
  };
}
