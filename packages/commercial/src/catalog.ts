import { DECISION_ID, type FlagEnv } from '@ln/contracts';
import { FORMAT_SEEDS } from './formats.data';
import type { CommercialFormat, FormatSeed, FormatStatus } from './types';

/** Capacidade operacional declarada por formato (id -> true). Regra Blueprint: sem capacidade operacional, não fica à venda. */
export type CapacityDeclaration = Readonly<Record<string, boolean>>;

const UNAVAILABLE: Record<string, string> = {
  'redes-e-canais--carrossel-instagram': 'Instagram construído, entrega desligada até P-01 (flag).',
  'redes-e-canais--envio-whatsapp': 'Canal WhatsApp sem operação definida.',
  'redes-e-canais--nota-na-newsletter': 'The Loyal construído, entrega desligada até P-02 (flag).',
  'impulsionamento--instagram': 'Instagram desligado até P-01 (flag).',
};
const THE_LOYAL_REASON = 'The Loyal construído, entrega desligada até P-02 (flag).';
const TALKS_REASON = 'Loyalty Talks sem operação de produção/estúdio definida.';

function defaultReason(f: FormatSeed): { status: FormatStatus; reason: string } {
  if (UNAVAILABLE[f.id]) return { status: 'indisponivel', reason: UNAVAILABLE[f.id]! };
  if (f.id.startsWith('the-loyal--')) return { status: 'indisponivel', reason: THE_LOYAL_REASON };
  if (f.id.startsWith('loyalty-talks--')) return { status: 'indisponivel', reason: TALKS_REASON };
  return { status: 'sob_consulta', reason: 'Sem capacidade operacional declarada; venda somente sob consulta/proposta.' };
}

/**
 * Constrói o catálogo. `capacity[id]=true` (só existe com decisão do proprietário, via CAPACITY_RELEASES) promove o formato a 'disponivel'.
 * Sem liberação nada é promovido. Um formato que o código marcava 'indisponivel' (canal desligado ou sem operação) só é promovido por
 * liberação explícita do proprietário (DP-54, produção) e leva a ressalva do motivo original no texto do estado.
 */
export function buildCatalog(capacity: CapacityDeclaration = {}): readonly CommercialFormat[] {
  return FORMAT_SEEDS.map((s) => {
    const d = defaultReason(s);
    const promote = capacity[s.id] === true;
    const statusReason = !promote ? d.reason : d.status === 'indisponivel' ? `Capacidade operacional declarada. ${RESSALVA} ${d.reason}` : 'Capacidade operacional declarada.';
    return { ...s, status: promote ? 'disponivel' : d.status, statusReason, isReferencePrice: true } as CommercialFormat;
  });
}
/** Prefixo da ressalva quando o proprietário libera para proposta um formato cujo canal ainda não opera. */
const RESSALVA = 'Ressalva: a entrega só começa com o canal ativo;';

/**
 * Liberação de venda por formato e por ambiente (mesmo padrão do FLAG_RELEASES, ADR-022). Um formato só vira 'disponivel' no ambiente
 * em que tem aqui o id da decisão do proprietário; sem id (null) fica como o código o define ('sob_consulta' ou 'indisponivel').
 *
 * DP-43 (23/11/2026), STAGING: só Topo, Laterais 1-3 (um formato, 3 posições) e Rodapé. Os outros 44 não são liberados no staging.
 * DP-54 (24/11/2026), PRODUÇÃO: o proprietário liberou os 47 formatos para PROPOSTA. Isto muda o catálogo e o mídia kit; NÃO liga o ad server
 * nem a aprovação/ativação de campanha em produção: essas seguem travadas por FLAG_RELEASES.adServerVendas.production (contrato) até a
 * decisão registrada ali (vendaLiberadaNoAmbiente).
 */
export type CapacityRelease = { staging: string | null; production: string | null };
const DP43_STAGING: ReadonlySet<string> = new Set(['banners--banner-topo', 'banners--retangulo-sidebar', 'banners--banner-rodape']);
export const CAPACITY_RELEASES: Readonly<Record<string, CapacityRelease>> = Object.fromEntries(
  FORMAT_SEEDS.map((f) => [f.id, { staging: DP43_STAGING.has(f.id) ? 'DP-43' : null, production: 'DP-54' } satisfies CapacityRelease]),
);

/** Id da decisão que libera o formato neste ambiente, ou null (ambiente desconhecido, local ou CI nunca libera nada). */
export function capacityDecision(formatId: string, env: FlagEnv | null): string | null {
  if (env === null) return null;
  const id = CAPACITY_RELEASES[formatId]?.[env] ?? null;
  return typeof id === 'string' && DECISION_ID.test(id) ? id : null;
}

/** Capacidade declarada para o ambiente: só os formatos com decisão válida. */
export function capacityFor(env: FlagEnv | null): CapacityDeclaration {
  const out: Record<string, boolean> = {};
  for (const id of Object.keys(CAPACITY_RELEASES)) if (capacityDecision(id, env) !== null) out[id] = true;
  return out;
}

/** Catálogo do ambiente: o de `buildCatalog` com a capacidade liberada por decisão (o motivo cita a DP). */
export function catalogFor(env: FlagEnv | null): readonly CommercialFormat[] {
  return buildCatalog(capacityFor(env)).map((f) => {
    const dp = f.status === 'disponivel' ? capacityDecision(f.id, env) : null;
    if (!dp) return f;
    // Formato liberado que o código dava como 'indisponivel' (canal desligado): mantém a ressalva do motivo original, para o Studio ver.
    const ressalva = f.statusReason.includes(RESSALVA) ? f.statusReason.slice(f.statusReason.indexOf(RESSALVA)) : '';
    return { ...f, statusReason: `Liberado pelo proprietário (${dp}) neste ambiente.${ressalva ? ` ${ressalva}` : ''}` };
  });
}

const RANK: Record<FormatStatus, number> = { indisponivel: 0, sob_consulta: 1, disponivel: 2 };
/**
 * Disponibilidade efetiva = código (com a liberação do ambiente) + estado gravado no banco. Falha fechada:
 * - 'indisponivel' no banco SEMPRE rebaixa (retirar um formato da venda não depende de deploy);
 * - o banco nunca promove acima do código: 'disponivel' no banco sem liberação vale o que o código diz;
 * - formato liberado pelo código fica 'disponivel' mesmo com o 'sob_consulta' que o seed gravou (o seed não distingue "padrão" de "escolha").
 */
export function resolveFormatStatus(code: { status: FormatStatus; statusReason: string }, stored: { status: FormatStatus; reason: string } | undefined): { status: FormatStatus; statusReason: string } {
  if (!stored) return { status: code.status, statusReason: code.statusReason };
  if (stored.status === 'indisponivel') return { status: 'indisponivel', statusReason: stored.reason };
  if (code.status === 'disponivel') return { status: 'disponivel', statusReason: code.statusReason };
  const lower = RANK[stored.status] <= RANK[code.status] ? stored : { status: code.status, reason: code.statusReason };
  return { status: lower.status, statusReason: lower.reason };
}

export const CATALOG: readonly CommercialFormat[] = buildCatalog();
export function getFormat(id: string, catalog: readonly CommercialFormat[] = CATALOG): CommercialFormat | undefined {
  return catalog.find((f) => f.id === id);
}
export function formatBRL(n: number): string {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
export function priceLabel(f: CommercialFormat): string {
  if (f.priceType === 'verba_mais_taxa') return `verba + ${f.feePct}% (gestão de mídia)`;
  const u = f.unit === 'mes' ? '/mês' : f.unit === 'dia' ? '/dia' : '';
  return (f.priceType === 'a_partir_de' ? 'a partir de ' : '') + formatBRL(f.fromBRL ?? 0) + u;
}
// Preços dos 3 pacotes com valor: DP-56 (25/11/2026), fast-track/comercial/precos-lancamento.md, seção 5.
export const PACKAGES = [
  { id: 'pacote.presenca-no-mercado', name: 'Presença no mercado', priceBRLMonth: 1500, deliverables: 'sidebar + rodapé + LinkedIn' },
  { id: 'pacote.construir-reputacao', name: 'Construir reputação', priceBRLMonth: 3900, deliverables: 'topo + sidebar + matéria mensal + LinkedIn/Instagram' },
  { id: 'pacote.liderar-uma-editoria', name: 'Liderar uma editoria', priceBRLMonth: 4900, deliverables: 'topo + sidebar + rodapé + matéria mensal + entrevista trimestral + redes' },
  { id: 'pacote.lancamento-de-programa', name: 'Lançamento de programa', priceBRLMonth: null, deliverables: 'matéria + entrevista + bloco newsletter + impulsionamento' },
  { id: 'pacote.evento-completo', name: 'Evento completo', priceBRLMonth: null, deliverables: 'agenda + banner + cobertura completa e matéria' },
  { id: 'pacote.autoridade', name: 'Autoridade', priceBRLMonth: null, deliverables: 'podcast + entrevista vídeo + opinião assinada' },
  { id: 'pacote.presenca-anual', name: 'Presença anual', priceBRLMonth: null, deliverables: 'topo + newsletter + 4 matérias; contrato 12m' },
  { id: 'pacote.customizado', name: 'Customizado', priceBRLMonth: null, deliverables: 'proposta com escopo, prazo, custo e inventário' },
] as const; // fora da contagem dos 47; preço null = sob proposta
