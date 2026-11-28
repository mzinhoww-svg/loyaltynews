/**
 * Trava das fontes que o coletor do produto pode ler. Vale ALÉM do cadastro: habilitar uma fonte no Studio não basta.
 * Mudar a lista é um commit revisado que aponta a decisão registrada (id existente em governance/decisions.yaml).
 * Decisão vigente: DP-69, PM, 28/11/2026, sobre os pareceres 55 e 59 da Security (três fontes, com condições).
 */
export interface AllowedSource {
  id: string;
  /** O host faz parte da trava: trocar o endereço no cadastro não leva o coletor a outro site. */
  host: string;
  /** Assinatura exigida pela fonte no bloco "Fontes:" (a Câmara pede "Agência Câmara" e a autoria, quando houver). */
  attributionName?: string;
}

export interface CollectorAllowlist {
  decisionId: string;
  decidedOn: string;
  sources: readonly AllowedSource[];
}

export const COLLECTOR_ALLOWLIST: CollectorAllowlist = Object.freeze({
  decisionId: 'DP-69',
  decidedOn: '2026-11-28',
  sources: Object.freeze([
    Object.freeze({ id: 'abemf', host: 'web.abemf.com.br' }),
    Object.freeze({ id: 'camara-noticias', host: 'www.camara.leg.br', attributionName: 'Agência Câmara (Câmara dos Deputados)' }),
    Object.freeze({ id: 'procon-sp', host: 'www.procon.sp.gov.br' }),
  ]),
});

export function isAllowedSource(source: { id: string; host: string }, list: CollectorAllowlist): boolean {
  return list.sources.some((a) => a.id === source.id && a.host === source.host.toLowerCase());
}

export const attributionNameOf = (sourceId: string, list: CollectorAllowlist = COLLECTOR_ALLOWLIST): string | undefined =>
  list.sources.find((a) => a.id === sourceId)?.attributionName;
