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

/** Quem monta um coletor nos workers: a coleta contínua, a fábrica avulsa (inclui o piloto) e a pauta autoral. */
export type CollectorUse = 'coleta_continua' | 'fabrica' | 'pauta_autoral';

export interface CollectorAllowlist {
  decisionId: string;
  decidedOn: string;
  sources: readonly AllowedSource[];
  /** Onde a trava e o teto por hora valem. Ligar outro uso pede nova decisão registrada. */
  appliesTo: readonly CollectorUse[];
}

export const COLLECTOR_ALLOWLIST: CollectorAllowlist = Object.freeze({
  decisionId: 'DP-69',
  decidedOn: '2026-11-28',
  // PM, 28/11: só a coleta contínua do produto; piloto e pauta autoral ficam de fora até nova decisão
  appliesTo: Object.freeze(['coleta_continua'] as const),
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
