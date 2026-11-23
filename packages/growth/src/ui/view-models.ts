import type { PackageListItem, PackageStatus } from '../dashboard/types';
import type { Channel } from '../types';

// View-models puros dos componentes do Studio: rótulos em português, segmentação de texto e contadores.
// Sem React e sem node:*; testados em unidade e seguros no cliente.

export const STATUS_LABEL: Record<PackageStatus, string> = {
  gerado: 'Gerado',
  bloqueado: 'Bloqueado',
  simulado: 'Publicado (simulado)',
  recusado: 'Recusado pelo publicador',
  falhou: 'Falha na geração',
};

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger';

export const STATUS_TONE: Record<PackageStatus, Tone> = {
  gerado: 'ok',
  bloqueado: 'warn',
  simulado: 'neutral',
  recusado: 'danger',
  falhou: 'danger',
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  the_loyal: 'The Loyal',
};

const BLOCKER_LABEL: Record<string, string> = {
  gates_automaticos_pendentes: 'Gates automáticos (WF02/WF03) ainda não passaram',
  sem_imagem_aprovada: 'Sem imagem aprovada pelo gate de mídia',
  mock_nao_publicavel: 'Matéria de demonstração (MOCK): não publicável',
  'canal_desligado:instagram': 'Instagram desligado (flag)',
  'canal_desligado:the_loyal': 'The Loyal desligado (flag)',
  brandkit_proposal_not_approved: 'Brandkit ainda é proposta (não aprovado)',
};

export interface BlockerInfo {
  code: string;
  label: string;
  /** `real`: só impede a publicação real; `sempre`: impede também a simulação. */
  scope: 'real' | 'sempre';
}

export function blockerInfo(code: string): BlockerInfo {
  const realOnly = code === 'mock_nao_publicavel' || code.startsWith('brandkit_');
  const known = BLOCKER_LABEL[code];
  const label = known ?? (code.startsWith('regra:') ? `Regra violada: ${code.slice(6)}` : code);
  return { code, label, scope: realOnly ? 'real' : 'sempre' };
}

export type CopySegment = { type: 'text' | 'mention' | 'link' | 'hashtag'; value: string };

/** Divide o texto do post em segmentos para destacar menções (@[Nome]), links e hashtags. Nunca interpreta HTML. */
export function splitCopy(text: string): CopySegment[] {
  const out: CopySegment[] = [];
  const re = /@\[([^\]]+)\]|https?:\/\/\S+|#[\p{L}\p{N}_]+/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: 'text', value: text.slice(last, i) });
    const tok = m[0];
    if (tok.startsWith('@[')) out.push({ type: 'mention', value: m[1] ?? '' });
    else if (tok.startsWith('#')) out.push({ type: 'hashtag', value: tok });
    else out.push({ type: 'link', value: tok });
    last = i + tok.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

export interface CopyStats {
  chars: number;
  charsMax: number;
  hookChars: number;
  hookMax: number;
}

export function copyStats(text: string, channel: Channel = 'linkedin'): CopyStats {
  return {
    chars: text.length,
    charsMax: channel === 'instagram' ? 2200 : 3000,
    hookChars: (text.split('\n')[0] ?? '').length,
    hookMax: 210,
  };
}

/** Data URI do SVG para `<img>`: o navegador não executa script em SVG carregado como imagem. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function brandStatusLabel(status: string): string {
  return status === 'approved' ? 'Brandkit aprovado' : 'Brandkit: proposta, não aprovada';
}

export interface QueueRowVm {
  id: string;
  articleId: string;
  channel: string;
  status: PackageStatus;
  statusLabel: string;
  tone: Tone;
  blockers: BlockerInfo[];
  receipts: number;
  title: string;
  mock: boolean;
}

export function queueRowVm(item: PackageListItem): QueueRowVm {
  return {
    id: item.id,
    articleId: item.articleId,
    channel: CHANNEL_LABEL[item.channel],
    status: item.status,
    statusLabel: STATUS_LABEL[item.status],
    tone: STATUS_TONE[item.status],
    blockers: item.blockers.map(blockerInfo),
    receipts: item.receipts.length,
    title: item.summary?.title ?? item.articleId,
    mock: item.mock,
  };
}
