import { FORMAT_SEEDS } from './formats.data.ts';
import type { CommercialFormat, FormatSeed, FormatStatus } from './types.ts';

/** Capacidade operacional declarada por formato (id -> true). Regra Blueprint: sem capacidade operacional, não fica à venda. */
export type CapacityDeclaration = Readonly<Record<string, boolean>>;

const UNAVAILABLE: Record<string, string> = {
  'redes-e-canais.carrossel-instagram': 'Instagram construído, entrega desligada até P-01 (flag).',
  'redes-e-canais.envio-whatsapp': 'Canal WhatsApp sem operação definida.',
  'redes-e-canais.nota-na-newsletter': 'The Loyal construído, entrega desligada até P-02 (flag).',
  'impulsionamento.instagram': 'Instagram desligado até P-01 (flag).',
};
const THE_LOYAL_REASON = 'The Loyal construído, entrega desligada até P-02 (flag).';
const TALKS_REASON = 'Loyalty Talks sem operação de produção/estúdio definida.';

function defaultReason(f: FormatSeed): { status: FormatStatus; reason: string } {
  if (UNAVAILABLE[f.id]) return { status: 'indisponivel', reason: UNAVAILABLE[f.id]! };
  if (f.id.startsWith('the-loyal.')) return { status: 'indisponivel', reason: THE_LOYAL_REASON };
  if (f.id.startsWith('loyalty-talks.')) return { status: 'indisponivel', reason: TALKS_REASON };
  return { status: 'sob_consulta', reason: 'Sem capacidade operacional declarada; venda somente sob consulta/proposta.' };
}

/** Constrói o catálogo. `capacity[id]=true` promove 'sob_consulta' a 'ativo' (nunca promove 'indisponivel'). */
export function buildCatalog(capacity: CapacityDeclaration = {}): readonly CommercialFormat[] {
  return FORMAT_SEEDS.map((s) => {
    const d = defaultReason(s);
    const promote = d.status === 'sob_consulta' && capacity[s.id] === true;
    return { ...s, status: promote ? 'ativo' : d.status, statusReason: promote ? 'Capacidade operacional declarada.' : d.reason, isReferencePrice: true } as CommercialFormat;
  });
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
export const PACKAGES = [
  { id: 'pacote.presenca-no-mercado', name: 'Presença no mercado', priceBRLMonth: 4000, deliverables: 'sidebar + rodapé + LinkedIn' },
  { id: 'pacote.construir-reputacao', name: 'Construir reputação', priceBRLMonth: 6000, deliverables: 'topo + sidebar + matéria mensal + LinkedIn/Instagram' },
  { id: 'pacote.liderar-uma-editoria', name: 'Liderar uma editoria', priceBRLMonth: 9000, deliverables: 'topo + sidebar + rodapé + matéria mensal + entrevista trimestral + redes' },
  { id: 'pacote.lancamento-de-programa', name: 'Lançamento de programa', priceBRLMonth: null, deliverables: 'matéria + entrevista + bloco newsletter + impulsionamento' },
  { id: 'pacote.evento-completo', name: 'Evento completo', priceBRLMonth: null, deliverables: 'agenda + banner + cobertura completa e matéria' },
  { id: 'pacote.autoridade', name: 'Autoridade', priceBRLMonth: null, deliverables: 'podcast + entrevista vídeo + opinião assinada' },
  { id: 'pacote.presenca-anual', name: 'Presença anual', priceBRLMonth: null, deliverables: 'topo + newsletter + 4 matérias; contrato 12m' },
  { id: 'pacote.customizado', name: 'Customizado', priceBRLMonth: null, deliverables: 'proposta com escopo, prazo, custo e inventário' },
] as const; // fora da contagem dos 47; preço null = sob proposta
