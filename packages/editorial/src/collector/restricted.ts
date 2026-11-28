/**
 * Regras que valem em TODO coletor, com ou sem lista permitida (PM, 28/11, parecer 68 da Security;
 * fast-track\decisoes\decisao-pm-travas-fora-da-coleta-20261128.md). Não há opção para desligar. Valem por id e por domínio
 * (com subdomínios), para trocar o nome ou o endereço no cadastro não abrir caminho.
 */
interface SourceGroup { decisionId: string; ids: readonly string[]; domains: readonly string[] }

/** Fontes cujos termos não permitem o uso (pareceres 55 e 63): nunca são lidas. */
export const EXCLUDED_SOURCES: SourceGroup = Object.freeze({
  decisionId: 'DP-69',
  ids: Object.freeze(['skift', 'cathay', 'iata', 'bain']),
  // asiamiles.com (programa da Cathay) e bain.com.br: PM, 28/11, sobre o parecer 70
  domains: Object.freeze(['skift.com', 'cathaypacific.com', 'cathay.com', 'asiamiles.com', 'iata.org', 'bain.com', 'bain.com.br', 'netpromotersystem.com']),
});

/**
 * Blogs aceitos pela DP-103 com as condições do parecer 64: só o coletor direto, com o próprio nome, sem sombra, teto de
 * `maxPerHour` e pausa persistentes. Sem contador persistente, não são lidos.
 */
export const RESTRICTED_BLOGS: SourceGroup & { maxPerHour: number } = Object.freeze({
  decisionId: 'DP-103',
  ids: Object.freeze(['passageiro-de-primeira', 'mestre-das-milhas']),
  domains: Object.freeze(['passageirodeprimeira.com', 'mestredasmilhas.com']),
  maxPerHour: 6,
});

const inDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

function matches(source: { id: string; host: string }, group: SourceGroup): boolean {
  const host = source.host.toLowerCase().replace(/\.$/, '');
  return group.ids.some((id) => source.id === id || source.id.startsWith(`${id}-`)) || group.domains.some((d) => inDomain(host, d));
}

export const isExcludedSource = (source: { id: string; host: string }): boolean => matches(source, EXCLUDED_SOURCES);
export const isRestrictedBlog = (source: { id: string; host: string }): boolean => matches(source, RESTRICTED_BLOGS);
