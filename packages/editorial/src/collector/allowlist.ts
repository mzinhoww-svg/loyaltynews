/**
 * Trava das fontes que o coletor do produto pode ler. Vale ALÉM do cadastro: habilitar uma fonte no Studio não basta.
 * Mudar a lista é um commit revisado que aponta a decisão registrada (id existente em governance/decisions.yaml).
 * Decisão vigente: DP-103, proprietário, 28/11/2026 (os dois blogs voltam e o coletor pode baixar a página), com as condições dos
 * pareceres 64 e 65 da Security. Antes dela, DP-69 (três fontes). A entrada da DP-103 em decisions.yaml entra pelo 5º ato.
 */
export interface AllowedSource {
  id: string;
  /** O host faz parte da trava: trocar o endereço no cadastro não leva o coletor a outro site. */
  host: string;
  /** Teto de requisições por hora que o cadastro não consegue aumentar (vale o menor dos dois). */
  maxPerHour: number;
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
  decisionId: 'DP-103',
  decidedOn: '2026-11-28',
  // PM, 28/11: só a coleta contínua do produto; piloto e pauta autoral ficam de fora até nova decisão
  appliesTo: Object.freeze(['coleta_continua'] as const),
  sources: Object.freeze([
    Object.freeze({ id: 'abemf', host: 'web.abemf.com.br', maxPerHour: 6 }),
    Object.freeze({ id: 'camara-noticias', host: 'www.camara.leg.br', maxPerHour: 6, attributionName: 'Agência Câmara (Câmara dos Deputados)' }),
    Object.freeze({ id: 'procon-sp', host: 'www.procon.sp.gov.br', maxPerHour: 6 }),
    Object.freeze({ id: 'passageiro-de-primeira', host: 'passageirodeprimeira.com', maxPerHour: 6 }),
    Object.freeze({ id: 'mestre-das-milhas', host: 'mestredasmilhas.com', maxPerHour: 6 }),
  ]),
});

export const allowedEntry = (source: { id: string; host: string }, list: CollectorAllowlist): AllowedSource | undefined =>
  list.sources.find((a) => a.id === source.id && a.host === source.host.toLowerCase());

export function isAllowedSource(source: { id: string; host: string }, list: CollectorAllowlist): boolean {
  return allowedEntry(source, list) !== undefined;
}

export const attributionNameOf = (sourceId: string, list: CollectorAllowlist = COLLECTOR_ALLOWLIST): string | undefined =>
  list.sources.find((a) => a.id === sourceId)?.attributionName;
