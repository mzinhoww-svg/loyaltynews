import type { DirectReadEvent, ReaderPort } from '../collector/collector';

/**
 * Shadow AO VIVO do roteador de scraping (Diretiva V3 §14; dono: loyalty-news-scraping-benchmark). Só MEDE: para cada URL que o coletor
 * lê, o roteador lê a mesma em sombra e grava apenas a comparação (status, tamanho, hash, latência, créditos, provedor). O Editorial não
 * depende do pacote do benchmark: recebe esta porta por injeção, e só o main do worker a carrega, com SCRAPING_SHADOW_MODE=true.
 * Garantias do lado do Editorial: o coletor recebe EXATAMENTE o resultado do caminho atual; erro da sombra nunca chega ao coletor;
 * nada é gravado como matéria nem no banco de matérias; o job espera a fila da sombra terminar (drain) antes de encerrar.
 */
export interface ShadowPort {
  /** Registra o resultado do caminho ATUAL (leitura direta ou via provedor) e agenda a leitura em sombra. Nunca deve lançar. */
  observe(url: string, outcome: { name: string; status: number; body?: string; ms: number }): void;
  /** Espera a fila da sombra (fim do job). */
  drain(): Promise<void>;
}

/**
 * Leitor do coletor com observação: devolve EXATAMENTE o resultado do leitor atual (e repassa a exceção dele, sem segunda leitura);
 * a sombra só recebe uma cópia do resultado, e o erro dela é engolido. Usa `observe` (não o `wrap` do benchmark, que descarta o `discover`
 * do leitor: a descoberta DP-31 depende dele). `discover` é preservado.
 */
export function shadowReader(primary: ReaderPort | undefined, shadow: ShadowPort | undefined): ReaderPort | undefined {
  if (!primary || !shadow) return primary;
  return {
    name: primary.name,
    ...(primary.unlocks !== undefined ? { unlocks: primary.unlocks } : {}),
    read: async (url) => {
      const t0 = Date.now();
      const res = await primary.read(url);
      try { shadow.observe(url, { name: primary.name, status: res.status, body: res.body, ms: Date.now() - t0 }); } catch { /* medição */ }
      return res;
    },
    ...(primary.discover ? { discover: primary.discover.bind(primary) } : {}),
  };
}

/** Observador de leituras diretas para o coletor: encaminha à sombra sem nunca lançar. */
export function shadowObserver(shadow: ShadowPort | undefined): ((e: DirectReadEvent) => void) | undefined {
  if (!shadow) return undefined;
  return (e) => { try { shadow.observe(e.url, { name: 'direct', status: e.status, ...(e.body !== undefined ? { body: e.body } : {}), ms: e.ms }); } catch { /* medição */ } };
}

/** Fim do job: espera a fila da sombra sem deixar o erro dela derrubar o job. */
export async function drainShadow(shadow: ShadowPort | undefined): Promise<void> {
  if (!shadow) return;
  try { await shadow.drain(); } catch { /* medição */ }
}
