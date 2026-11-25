import * as React from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { DashboardSummary, PackageListItem, PackageStatus, QueueResult, SocialPackageRecord } from '../dashboard/types';
import type { PublishReceipt } from '../mlabs/port';
import { TOKENS_JSON } from '../creative/assets.data';
import {
  blockerInfo, brandStatusLabel, CHANNEL_LABEL, copyStats, queueRowVm, splitCopy, STATUS_LABEL, STATUS_TONE, svgDataUri,
  type Tone,
} from './view-models';

// Componentes de prévia do criativo e do Social Dashboard, reutilizáveis no LN Studio. Escritos com createElement
// (sem JSX) para entrar no typecheck da raiz sem exigir `--jsx` no tsconfig do Arquiteto. Sem hooks, sem estado e sem
// `node:*`: servem em Server Components e em Client Components. Estilo inline com os tokens do brandkit para não
// depender do design system até ele entrar no scaffold. Todo MOCK aparece escrito na interface (fast-track regra 2).

const h = React.createElement;
const C = TOKENS_JSON.colors;
/**
 * Acento de TEXTO sobre fundo claro: token do design system `--ln-color-secondary-strong`
 * (o `secondary` cru fica em 4,29:1 no branco e reprova AA). O `TOKENS_JSON` do Growth é o
 * brandkit literal e não traz a extensão; o token vem do CSS do design system, que o Studio carrega.
 */
const ACENTO_TEXTO = "var(--ln-color-secondary-strong)";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: C.mint, fg: C.primary },
  ok: { bg: '#d6f0e3', fg: '#0e4a2c' },
  warn: { bg: '#fdf0c8', fg: '#5a4300' },
  danger: { bg: '#f8d9d6', fg: '#7a1410' },
};

const chip = (tone: Tone): CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 12, fontWeight: 700,
  letterSpacing: 0.4, background: TONE[tone].bg, color: TONE[tone].fg,
});

const kids = (...n: ReactNode[]): ReactNode[] => n;

export function MockBadge(): ReactElement {
  return h('span', { role: 'note', style: { ...chip('danger'), textTransform: 'uppercase' } }, 'MOCK — não publicar');
}

export function StatusBadge({ status }: { status: PackageStatus }): ReactElement {
  return h('span', { 'data-status': status, style: chip(STATUS_TONE[status]) }, STATUS_LABEL[status]);
}

export interface CreativePreviewProps {
  /** SVG do criativo (de `getPackage`). Ausente: mostra o estado vazio. */
  svg?: string;
  alt: string;
  mock?: boolean;
  brandStatus?: string;
  width?: number;
  caption?: string;
}

export function CreativePreview({ svg, alt, mock, brandStatus, width = 480, caption }: CreativePreviewProps): ReactElement {
  const picture = svg
    ? h('img', { src: svgDataUri(svg), alt, style: { display: 'block', width: '100%', height: 'auto', border: `1px solid ${C.mint}` } })
    : h('div', { role: 'img', 'aria-label': alt, style: { padding: 24, background: C.mint, color: C.primary, textAlign: 'center' } },
        'Prévia indisponível: abra o pacote para carregar o criativo.');
  return h('figure', { style: { margin: 0, maxWidth: width } },
    picture,
    h('figcaption', { style: { fontSize: 12, marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
      mock ? h(MockBadge) : null,
      h('span', { style: chip(brandStatus === 'approved' ? 'ok' : 'warn') }, brandStatusLabel(brandStatus ?? 'unknown')),
      caption ? h('span', null, caption) : null,
    ),
  );
}

export interface CopyPreviewProps {
  text: string;
  channel?: 'linkedin' | 'instagram';
  textOnlyFallback?: boolean;
}

export function CopyPreview({ text, channel = 'linkedin', textOnlyFallback }: CopyPreviewProps): ReactElement {
  const stats = copyStats(text, channel);
  const parts = splitCopy(text).map((s, i): ReactNode => {
    if (s.type === 'mention') return h('mark', { key: i, 'data-mention': s.value, style: { background: C.signal, color: C.primary } }, `@${s.value}`);
    if (s.type === 'hashtag') return h('span', { key: i, style: { color: ACENTO_TEXTO } }, s.value);
    if (s.type === 'link') return h('span', { key: i, 'data-link': true, style: { color: ACENTO_TEXTO, textDecoration: 'underline', wordBreak: 'break-all' } }, s.value);
    return h(React.Fragment, { key: i }, s.value);
  });
  return h('section', { 'aria-label': 'Texto do post' },
    h('p', { style: { whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'Inter, Arial, sans-serif', fontSize: 14, lineHeight: 1.5 } }, ...parts),
    h('p', { style: { fontSize: 12, margin: '8px 0 0' } },
      h('span', { 'data-counter': 'chars' }, `${stats.chars}/${stats.charsMax} caracteres`),
      ' · ',
      h('span', { 'data-counter': 'hook' }, `gancho ${stats.hookChars}/${stats.hookMax}`),
      textOnlyFallback ? h('span', null, ' · ', h('span', { 'data-fallback': true }, 'sem menção marcável: texto puro')) : null,
    ),
  );
}

export function BlockersList({ blockers }: { blockers: string[] }): ReactElement {
  if (blockers.length === 0) return h('p', { 'data-empty': true }, 'Sem bloqueios.');
  return h('ul', { 'aria-label': 'Bloqueios', style: { margin: 0, paddingLeft: 18 } },
    ...blockers.map((b) => {
      const info = blockerInfo(b);
      return h('li', { key: b, 'data-blocker': b },
        `${info.label} `,
        h('small', null, `(${info.scope === 'real' ? 'impede só a publicação real' : 'impede também a simulação'})`),
      );
    }),
  );
}

export function ReceiptList({ receipts }: { receipts: PublishReceipt[] }): ReactElement {
  if (receipts.length === 0) return h('p', { 'data-empty': true }, 'Nenhum recibo.');
  return h('ul', { 'aria-label': 'Recibos', style: { margin: 0, paddingLeft: 18 } },
    ...receipts.map((r) => h('li', { key: r.id, 'data-receipt': r.id },
      ...kids(
        h('code', null, r.id),
        ` · ${CHANNEL_LABEL[r.channel]} · ${r.status} · ${r.createdAt} `,
        r.simulated ? h('span', { style: chip('neutral') }, 'SIMULADO') : h('span', { style: chip('danger') }, 'REAL'),
      ))),
  );
}

export function PackageCard({ record }: { record: SocialPackageRecord }): ReactElement {
  const s = record.summary;
  const headingId = `pkg-${record.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return h('article', { 'aria-labelledby': headingId, style: { border: `1px solid ${C.mint}`, padding: 16, display: 'grid', gap: 12 } },
    h('header', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      h('h3', { id: headingId, style: { margin: 0, fontSize: 18 } }, s?.title ?? record.articleId),
      h('span', null, CHANNEL_LABEL[record.channel]),
      h(StatusBadge, { status: record.status }),
      record.mock ? h(MockBadge) : null,
    ),
    record.failure
      ? h('p', { role: 'alert', style: { margin: 0 } }, `Falha na geração: ${record.failure.rules.join(', ')}.`)
      : null,
    s
      ? h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' } },
          h(CreativePreview, {
            svg: s.creative.svg, alt: `Criativo de ${s.title}`, mock: record.mock, brandStatus: s.creative.brandStatus,
            width: 360, caption: `${s.creative.width}×${s.creative.height}`,
          }),
          h('div', { style: { flex: '1 1 320px' } },
            h(CopyPreview, { text: s.copyText, channel: record.channel === 'instagram' ? 'instagram' : 'linkedin', textOnlyFallback: s.textOnlyFallback }),
          ),
        )
      : null,
    h('section', { 'aria-label': 'Bloqueios do pacote' },
      h('h4', { style: { margin: '0 0 4px' } }, 'Bloqueios'),
      h(BlockersList, { blockers: record.blockers }),
      record.lastRefusal ? h('p', { style: { margin: '4px 0 0' } }, 'Última recusa: ', h('code', null, record.lastRefusal)) : null,
    ),
    h('section', { 'aria-label': 'Recibos do pacote' },
      h('h4', { style: { margin: '0 0 4px' } }, 'Recibos'),
      h(ReceiptList, { receipts: record.receipts }),
    ),
  );
}

export interface PackageQueueProps {
  result: QueueResult;
  /** Gera o link de cada linha (ex.: `/studio/social/${id}`). Sem handlers: serve em Server Components. */
  hrefFor?: (item: PackageListItem) => string;
}

export function PackageQueue({ result, hrefFor }: PackageQueueProps): ReactElement {
  if (result.items.length === 0) {
    return h('p', { 'data-empty': true, role: 'status' }, 'Nenhum pacote social gerado ainda.');
  }
  const heads = ['Matéria', 'Canal', 'Estado', 'Bloqueios', 'Recibos'];
  return h('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: 14 } },
    h('caption', { style: { textAlign: 'left', padding: '4px 0' } }, `Fila de pacotes sociais: ${result.total} no total`),
    h('thead', null, h('tr', null, ...heads.map((t) =>
      h('th', { key: t, scope: 'col', style: { textAlign: 'left', borderBottom: `2px solid ${C.primary}`, padding: 6 } }, t)))),
    h('tbody', null, ...result.items.map((it) => {
      const vm = queueRowVm(it);
      return h('tr', { key: vm.id, 'data-package': vm.id },
        h('th', { scope: 'row', style: { textAlign: 'left', padding: 6, fontWeight: 600 } },
          hrefFor ? h('a', { href: hrefFor(it) }, vm.title) : vm.title,
          ' ',
          vm.mock ? h(MockBadge) : null,
        ),
        h('td', { style: { padding: 6 } }, vm.channel),
        h('td', { style: { padding: 6 } }, h(StatusBadge, { status: vm.status })),
        h('td', { style: { padding: 6 } }, vm.blockers.length === 0 ? '—' : vm.blockers.map((b) => b.label).join('; ')),
        h('td', { style: { padding: 6 } }, String(vm.receipts)),
      );
    })),
  );
}

const METRIC_STATUS_LABEL = { ok: 'ok', sem_dados: 'sem dados', indisponivel: 'indisponível' } as const;
const dash = (n: number | null) => (n === null ? '—' : String(n));

/** Linha de métricas do canal LinkedIn (mLabs, só leitura). Valor ausente aparece como "—", nunca como 0. */
export function metricsLine(m: DashboardSummary['metrics']): string {
  if (!m.available) return `Métricas: indisponíveis (${m.reason})`;
  const d = m.data;
  const pub = d.published.status === 'ok'
    ? `${dash(d.published.count)} post(s) publicado(s)${d.published.truncated ? ' (lista cortada)' : ''}`
    : `posts publicados ${METRIC_STATUS_LABEL[d.published.status]}${d.published.reason ? ` (${d.published.reason})` : ''}`;
  const fol = d.followers.status === 'ok'
    ? `${dash(d.followers.current)} seguidor(es)${d.followers.observedAt ? `, última observação ${d.followers.observedAt.slice(0, 10)}` : ''}`
    : `seguidores ${METRIC_STATUS_LABEL[d.followers.status]}${d.followers.reason ? ` (${d.followers.reason})` : ''}`;
  return `Métricas LinkedIn (mLabs, leitura, ${d.period.start} a ${d.period.end}): ${pub} · ${fol}`;
}

export function DashboardSummaryCards({ summary }: { summary: DashboardSummary }): ReactElement {
  const statuses = Object.keys(summary.totals.byStatus) as PackageStatus[];
  return h('section', { 'aria-label': 'Resumo do Social Dashboard', style: { display: 'grid', gap: 12 } },
    h('p', { role: 'status', style: { margin: 0 } }, summary.note),
    h('ul', { style: { display: 'flex', gap: 12, listStyle: 'none', padding: 0, margin: 0, flexWrap: 'wrap' } },
      ...summary.channels.map((c) => h('li', { key: c.channel, 'data-channel': c.channel, style: { border: `1px solid ${C.mint}`, padding: 12 } },
        h('strong', null, CHANNEL_LABEL[c.channel]),
        h('div', null, `${c.flagEnabled ? 'Chave ligada' : 'Chave desligada'} · ${c.mode === 'real' ? 'modo REAL' : 'modo simulado'}`),
        h('div', null, `${summary.totals.byChannel[c.channel]} pacote(s)`),
      )),
    ),
    h('p', { style: { margin: 0 }, 'data-totals': true },
      `${summary.totals.packages} pacote(s): ${statuses.map((s) => `${STATUS_LABEL[s]} ${summary.totals.byStatus[s]}`).join(' · ')}`),
    h('p', { style: { margin: 0 }, 'data-brand': true }, brandStatusLabel(summary.brandStatus)),
    h('p', { style: { margin: 0 }, 'data-metrics': true }, metricsLine(summary.metrics)),
  );
}
