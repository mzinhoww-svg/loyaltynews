/**
 * Layout determinístico de organograma (sem LLM, sem aleatoriedade, sem relógio): mesma entrada => mesma saída, byte a byte.
 * Serve ao portal e ao Studio. Regra visível: vínculo INFERIDO nunca aparece como fato — aresta tracejada, selo
 * "INFERIDO — NÃO CONFIRMADO" no desenho e entrada na legenda; só vínculo declarado é traço contínuo.
 *
 * Algoritmo (árvore em camadas, estilo Reingold–Tilford simplificado):
 *  1. Nós = pessoas (por id; sem id, por nome+cargo). Arestas = "superior → subordinado".
 *  2. Ciclos: arestas que fecham ciclo são descartadas do desenho (aviso `cycle_edge_dropped`), em ordem determinística.
 *  3. Nível = maior distância a partir das raízes (nós sem superior); y = nível * (altura + espaço vertical).
 *  4. Floresta geradora: cada nó escolhe o pai preferindo aresta DECLARADA, depois nome do superior, depois id. Demais arestas
 *     (multi-superior) viram conectores extras.
 *  5. x: folhas em colunas consecutivas na ordem (nome, cargo, id); pai centralizado sobre os filhos. Raízes lado a lado.
 */
import type { Certainty } from './types';

export interface OrgEdgeInput {
  id?: string;
  superior_person_id?: string;
  superior_name: string;
  superior_title: string;
  subordinate_person_id?: string;
  subordinate_name: string;
  subordinate_title: string;
  certainty: Certainty;
  display_label?: string;
  inference_basis?: string | null;
  evidence_id?: string;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  hGap?: number;
  vGap?: number;
  margin?: number;
  /** Caracteres antes de abreviar com reticências no desenho (o texto completo fica no <title>). */
  maxChars?: number;
}

export interface LayoutNode {
  id: string;
  name: string;
  title: string;
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Algum vínculo deste nó com o restante do organograma é inferido (não confirmado). */
  has_inferred_link: boolean;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  certainty: Certainty;
  /** 'solid' = declarado (fato); 'dashed' = inferido (nunca fato). */
  style: 'solid' | 'dashed';
  /** Presente só nas inferidas: o texto que a interface deve exibir junto da linha. */
  badge: string | null;
  label: string;
  inference_basis: string | null;
  /** Poligonal ortogonal (x,y) do centro inferior do superior ao centro superior do subordinado. */
  points: { x: number; y: number }[];
  /** Conector extra (nó com mais de um superior), fora da árvore geradora. */
  extra: boolean;
}

export interface OrgLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  legend: { style: 'solid' | 'dashed'; text: string }[];
  warnings: { code: 'cycle_edge_dropped'; edge_id: string }[];
  empty: boolean;
}

export const INFERRED_BADGE = 'INFERIDO — NÃO CONFIRMADO';
export const LEGEND_DECLARED = 'Linha contínua: vínculo declarado pela fonte.';
export const LEGEND_INFERRED = 'Linha tracejada: vínculo inferido, não confirmado (não é fato).';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const nodeKey = (id: string | undefined, name: string, title: string) => id ?? `${name}|${title}`;

export function layoutOrgChart(input: OrgEdgeInput[], options: LayoutOptions = {}): OrgLayout {
  const W = options.nodeWidth ?? 190, H = options.nodeHeight ?? 56, HG = options.hGap ?? 24, VG = options.vGap ?? 64, M = options.margin ?? 24;

  // 1. nós e arestas, ordenados de forma estável
  type N = { id: string; name: string; title: string };
  const nodes = new Map<string, N>();
  type E = { id: string; from: string; to: string; certainty: Certainty; label: string; basis: string | null; supName: string; src: OrgEdgeInput };
  const edges: E[] = [];
  for (const e of input) {
    const from = nodeKey(e.superior_person_id, e.superior_name, e.superior_title);
    const to = nodeKey(e.subordinate_person_id, e.subordinate_name, e.subordinate_title);
    if (from === to) continue;
    if (!nodes.has(from)) nodes.set(from, { id: from, name: e.superior_name, title: e.superior_title });
    if (!nodes.has(to)) nodes.set(to, { id: to, name: e.subordinate_name, title: e.subordinate_title });
    const id = e.id ?? `${from}->${to}`;
    // um vínculo declarado vale mais que um inferido entre o mesmo par
    edges.push({ id, from, to, certainty: e.certainty, label: e.display_label ?? (e.certainty === 'declared' ? 'fato (fonte declara)' : INFERRED_BADGE.toLowerCase()), basis: e.inference_basis ?? null, supName: e.superior_name, src: e });
  }
  edges.sort((a, b) => cmp(a.certainty, b.certainty) /* declared < inferred */ || cmp(a.supName, b.supName) || cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.id, b.id));
  const seenPair = new Set<string>();
  const uniq = edges.filter((e) => {
    const k = `${e.from}>${e.to}`;
    if (seenPair.has(k)) return false;
    seenPair.add(k);
    return true;
  });

  // 2. descarta arestas que fecham ciclo (processa na ordem estável; mantém a primeira que não cria ciclo)
  const kept: E[] = [];
  const warnings: OrgLayout['warnings'] = [];
  const canReach = (a: string, b: string) => {
    const seen = new Set<string>();
    const stack = [a];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === b) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const e of kept) if (e.from === x) stack.push(e.to);
    }
    return false;
  };
  for (const e of uniq) {
    if (canReach(e.to, e.from)) warnings.push({ code: 'cycle_edge_dropped', edge_id: e.id });
    else kept.push(e);
  }

  // 3. níveis: maior distância desde as raízes (grafo acíclico)
  const ids = [...nodes.keys()].sort((a, b) => cmp(nodes.get(a)!.name, nodes.get(b)!.name) || cmp(nodes.get(a)!.title, nodes.get(b)!.title) || cmp(a, b));
  const incoming = new Map<string, E[]>();
  const outgoing = new Map<string, E[]>();
  for (const id of ids) { incoming.set(id, []); outgoing.set(id, []); }
  for (const e of kept) { incoming.get(e.to)!.push(e); outgoing.get(e.from)!.push(e); }
  const level = new Map<string, number>();
  const levelOf = (id: string): number => {
    const cached = level.get(id);
    if (cached !== undefined) return cached;
    const inc = incoming.get(id)!;
    const l = inc.length === 0 ? 0 : Math.max(...inc.map((e) => levelOf(e.from))) + 1;
    level.set(id, l);
    return l;
  };
  for (const id of ids) levelOf(id);

  // 4. floresta geradora: pai preferido = aresta declarada, depois nome do superior, depois id (kept já está nessa ordem)
  const parentEdge = new Map<string, E>();
  for (const e of kept) if (!parentEdge.has(e.to)) parentEdge.set(e.to, e);
  const children = new Map<string, string[]>();
  for (const id of ids) children.set(id, []);
  for (const [child, e] of parentEdge) children.get(e.from)!.push(child);
  const order = (a: string, b: string) => cmp(nodes.get(a)!.name, nodes.get(b)!.name) || cmp(nodes.get(a)!.title, nodes.get(b)!.title) || cmp(a, b);
  for (const c of children.values()) c.sort(order);
  const roots = ids.filter((id) => !parentEdge.has(id)).sort(order);

  // 5. x por colunas de folhas; pai centralizado
  const xCenter = new Map<string, number>();
  let col = 0;
  const place = (id: string): number => {
    const ch = children.get(id)!;
    let cx: number;
    if (ch.length === 0) cx = col++;
    else {
      const xs = ch.map(place);
      cx = (xs[0]! + xs[xs.length - 1]!) / 2;
    }
    xCenter.set(id, cx);
    return cx;
  };
  for (const r of roots) place(r);
  // o filho pode estar num nível maior que pai+1 (multi-superior): y vem do nível, x da árvore
  const inferredNode = new Set<string>();
  for (const e of kept) if (e.certainty === 'inferred') { inferredNode.add(e.from); inferredNode.add(e.to); }

  const out: LayoutNode[] = ids.map((id) => ({
    id,
    name: nodes.get(id)!.name,
    title: nodes.get(id)!.title,
    level: level.get(id)!,
    x: M + xCenter.get(id)! * (W + HG),
    y: M + level.get(id)! * (H + VG),
    width: W,
    height: H,
    has_inferred_link: inferredNode.has(id),
  }));
  const byId = new Map(out.map((n) => [n.id, n]));

  const outEdges: LayoutEdge[] = kept.map((e) => {
    const a = byId.get(e.from)!, b = byId.get(e.to)!;
    const ax = a.x + W / 2, ay = a.y + H, bx = b.x + W / 2, by = b.y;
    const midY = ay + VG / 2;
    const extra = parentEdge.get(e.to) !== e;
    return {
      id: e.id, from: e.from, to: e.to, certainty: e.certainty,
      style: e.certainty === 'declared' ? 'solid' : 'dashed',
      badge: e.certainty === 'inferred' ? INFERRED_BADGE : null,
      label: e.certainty === 'declared' ? e.label : INFERRED_BADGE.toLowerCase(),
      inference_basis: e.certainty === 'inferred' ? e.basis : null,
      points: [{ x: ax, y: ay }, { x: ax, y: midY }, { x: bx, y: midY }, { x: bx, y: by }],
      extra,
    };
  });

  const maxX = out.reduce((m, n) => Math.max(m, n.x + W), 0);
  const maxY = out.reduce((m, n) => Math.max(m, n.y + H), 0);
  const hasInferred = outEdges.some((e) => e.certainty === 'inferred');
  const legend: OrgLayout['legend'] = [{ style: 'solid', text: LEGEND_DECLARED }];
  if (hasInferred) legend.push({ style: 'dashed', text: LEGEND_INFERRED });
  return {
    nodes: out, edges: outEdges, width: out.length ? maxX + M : 0, height: out.length ? maxY + M : 0, legend, warnings, empty: out.length === 0,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

/**
 * SVG estático (sem script, sem recurso externo) do layout. Inferido: linha tracejada + selo textual na linha.
 * `mock: true` imprime MOCK visível. Texto completo em <title> (acessibilidade e abreviações).
 */
export function renderOrgChartSvg(layout: OrgLayout, opts: { mock?: boolean; maxChars?: number; title?: string } = {}): string {
  const max = opts.maxChars ?? 26;
  const legendH = 22 * layout.legend.length + 12;
  const total = layout.height + legendH + (opts.mock ? 22 : 0);
  const w = Math.max(layout.width, 360);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${w}" height="${total}" viewBox="0 0 ${w} ${total}" font-family="sans-serif" font-size="12">`);
  parts.push(`<title>${esc(opts.title ?? 'Organograma')}</title>`);
  if (opts.mock) parts.push(`<text x="8" y="16" font-weight="bold" fill="#b00020">MOCK — dados de teste</text>`);
  const dy = opts.mock ? 22 : 0;
  parts.push(`<g transform="translate(0 ${dy})">`);
  for (const e of layout.edges) {
    const d = e.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
    const dash = e.style === 'dashed' ? ' stroke-dasharray="6 4"' : '';
    parts.push(`<path d="${d}" fill="none" stroke="${e.style === 'dashed' ? '#8a6d00' : '#222'}" stroke-width="1.5"${dash}><title>${esc(e.badge ?? e.label)}</title></path>`);
    if (e.badge) {
      const mid = e.points[1]!, end = e.points[2]!;
      parts.push(`<text x="${(mid.x + end.x) / 2 + 4}" y="${mid.y - 3}" font-size="9" fill="#8a6d00">${esc(e.badge)}</text>`);
    }
  }
  for (const n of layout.nodes) {
    const stroke = n.has_inferred_link ? '#8a6d00' : '#222';
    parts.push(
      `<g><title>${esc(`${n.name} — ${n.title}`)}</title>` +
        `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6" fill="#fff" stroke="${stroke}"/>` +
        `<text x="${n.x + 8}" y="${n.y + 22}" font-weight="bold">${esc(clip(n.name, max))}</text>` +
        `<text x="${n.x + 8}" y="${n.y + 40}" fill="#444">${esc(clip(n.title, max))}</text></g>`,
    );
  }
  parts.push('</g>');
  layout.legend.forEach((l, i) => {
    const y = layout.height + dy + 18 + i * 22;
    parts.push(`<line x1="8" y1="${y - 4}" x2="48" y2="${y - 4}" stroke="${l.style === 'dashed' ? '#8a6d00' : '#222'}" stroke-width="1.5"${l.style === 'dashed' ? ' stroke-dasharray="6 4"' : ''}/>`);
    parts.push(`<text x="56" y="${y}">${esc(l.text)}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}
