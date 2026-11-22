import type { Source } from '../types';

/**
 * Seed do registro de fontes primárias. HONESTIDADE: hosts abaixo são os domínios institucionais públicos conhecidos
 * dessas organizações, mas NENHUM foi conferido por humano/QA (urlVerified=false), NENHUM termo de uso foi revisado
 * (termsStatus='pending', J-14) e feeds/listagens não foram identificados (null — nunca inventar URL).
 * Consequência: todas enabled=false; o coletor recusa até que um responsável revise termos e confirme URLs.
 */
const base = {
  listingUrl: null, feedUrl: null, termsUrl: null, termsStatus: 'pending', urlVerified: false,
  robotsRespected: true, paywall: 'unknown', enabled: false, imageRights: null, maxRequestsPerHour: 6,
} as const;

export const SEED_SOURCES: Source[] = [
  { ...base, id: 'bcb', name: 'Banco Central do Brasil', kind: 'regulator', host: 'www.bcb.gov.br',
    editorias: ['regulacao', 'bancos', 'mercado'] },
  { ...base, id: 'cvm', name: 'Comissão de Valores Mobiliários', kind: 'regulator', host: 'www.gov.br', pathPrefix: '/cvm',
    editorias: ['regulacao', 'mercado'], notes: 'Host compartilhado; coleta restrita ao prefixo /cvm.' },
  { ...base, id: 'anpd', name: 'Autoridade Nacional de Proteção de Dados', kind: 'regulator', host: 'www.gov.br', pathPrefix: '/anpd',
    editorias: ['regulacao', 'tech', 'crm'], notes: 'Host compartilhado; coleta restrita ao prefixo /anpd.' },
  { ...base, id: 'senacon', name: 'Secretaria Nacional do Consumidor (MJSP)', kind: 'government', host: 'www.gov.br',
    editorias: ['regulacao', 'varejo', 'programas'], notes: 'Host compartilhado: prefixo do órgão ainda não confirmado (pendente da pesquisa de fontes); inelegível até definir pathPrefix.' },
  { ...base, id: 'abecs', name: 'ABECS — Associação Brasileira das Empresas de Cartões e Serviços', kind: 'association', host: 'www.abecs.org.br',
    editorias: ['bancos', 'mercado'] },
  { ...base, id: 'iata', name: 'IATA — Press Releases', kind: 'association', host: 'www.iata.org',
    editorias: ['travel', 'global', 'pontos'] },
  { ...base, id: 'azul-ri', name: 'Azul — Relações com Investidores', kind: 'investor_relations', host: 'ri.voeazul.com.br',
    editorias: ['pontos', 'travel', 'mercado'] },
  { ...base, id: 'gol-ri', name: 'GOL — Relações com Investidores', kind: 'investor_relations', host: 'ri.voegol.com.br',
    editorias: ['pontos', 'travel', 'mercado'] },
  { ...base, id: 'magalu-ri', name: 'Magazine Luiza — Relações com Investidores', kind: 'investor_relations', host: 'ri.magazineluiza.com.br',
    editorias: ['varejo', 'mercado'] },
  { ...base, id: 'latam-ir', name: 'LATAM Airlines Group — Investor Relations', kind: 'investor_relations', host: 'ir.latamairlines.com',
    editorias: ['pontos', 'travel', 'global'] },
];
