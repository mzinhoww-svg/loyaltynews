import type { MapPosition } from '../_lib/commercial-source';

/**
 * Mapa visual das posições de anúncio (auditoria V-13). Esquema da página em PROPORÇÃO das dimensões reais do inventário: topo, coluna
 * editorial, três retângulos de sidebar e rodapé. Não é captura de tela nem promete audiência: só mostra onde cada posição fica e o seu
 * tamanho. Posição sem dimensão definida não é desenhada: entra na lista como "dimensões em definição".
 */
const S = 0.5; // pixels do inventário → unidades do desenho
const GAP = 12;
const MARGIN = 16;
const LABEL_H = 22;

type Drawn = { id: string; name: string; w: number; h: number; x: number; y: number; dim: string };
const dims = (d: string): [number, number] => { const [w, h] = d.split('x').map(Number); return [w!, h!]; };
const dimLabel = (d: string): string => d.replace('x', ' × ');

export function PositionMap({ positions }: { positions: readonly MapPosition[] }) {
  const by = (id: string) => positions.find((p) => p.id === id && p.dimension);
  const top = by('TOP'); const footer = by('FOOTER');
  const sides = ['SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3'].map(by).filter((p): p is MapPosition & { dimension: string } => !!p);

  const drawn: Drawn[] = [];
  let y = MARGIN + LABEL_H;
  const widthOf = (p?: MapPosition) => (p?.dimension ? dims(p.dimension)[0] * S : 0);
  const sideW = Math.max(0, ...sides.map((p) => widthOf(p)));
  const pageW = Math.max(widthOf(top), widthOf(footer), sideW > 0 ? sideW + GAP + 240 : 0, 320);
  const place = (p: MapPosition & { dimension: string }, x: number, yy: number) => {
    const [w, h] = dims(p.dimension);
    drawn.push({ id: p.id, name: p.name, w: w * S, h: h * S, x, y: yy, dim: p.dimension });
    return h * S;
  };
  if (top?.dimension) y += place(top as MapPosition & { dimension: string }, MARGIN, y) + GAP;
  // coluna editorial (não vendida) + sidebars empilhadas à direita
  const sideStackH = sides.reduce((t, p) => t + dims(p.dimension)[1] * S, 0) + Math.max(0, sides.length - 1) * GAP;
  const editorialH = Math.max(sideStackH, 140);
  const editorialW = pageW - (sideW > 0 ? sideW + GAP : 0);
  const editorialY = y;
  let sy = y;
  for (const p of sides) sy += place(p, MARGIN + editorialW + GAP, sy) + GAP;
  y += editorialH + GAP;
  if (footer?.dimension) y += place(footer as MapPosition & { dimension: string }, MARGIN, y);
  const W = pageW + MARGIN * 2;
  const H = y + MARGIN;
  const describe = drawn.map((d) => `${d.name}, ${dimLabel(d.dim)} pixels`).join('; ');

  return (
    <figure className="pt-map" data-testid="mk-mapa">
      <svg viewBox={`0 0 ${Math.round(W)} ${Math.round(H)}`} role="img" aria-labelledby="mk-mapa-t mk-mapa-d" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <title id="mk-mapa-t">Mapa das posições de anúncio na página</title>
        <desc id="mk-mapa-d">Esquema em proporção das dimensões. {describe || 'Nenhuma posição com dimensão definida.'} A coluna editorial não é vendida.</desc>
        <rect className="pt-map-page" x={MARGIN / 2} y={MARGIN / 2} width={Math.round(W - MARGIN)} height={Math.round(H - MARGIN)} rx="8" />
        <text className="pt-map-cap" x={MARGIN} y={MARGIN + 14}>Página do portal (esquema)</text>
        <g data-testid="mk-mapa-editorial">
          <rect className="pt-map-editorial" x={MARGIN} y={editorialY} width={Math.round(editorialW)} height={Math.round(editorialH)} rx="6" />
          <text className="pt-map-text" x={MARGIN + 12} y={editorialY + 26}>Conteúdo editorial</text>
          <text className="pt-map-small" x={MARGIN + 12} y={editorialY + 48}>não é vendido</text>
        </g>
        {drawn.map((d) => (
          <g key={d.id} data-position={d.id}>
            <rect className="pt-map-slot" x={d.x} y={d.y} width={d.w} height={d.h} rx="6" data-w={d.w} data-h={d.h} />
            <text className="pt-map-text" x={d.x + d.w / 2} y={d.y + d.h / 2 - 2} textAnchor="middle">{d.name}</text>
            <text className="pt-map-small" x={d.x + d.w / 2} y={d.y + d.h / 2 + 28} textAnchor="middle">{dimLabel(d.dim)}</text>
          </g>
        ))}
      </svg>
      <figcaption>
        Esquema ilustrativo, em proporção das dimensões do inventário; não é captura de tela. Conteúdo publicitário é sempre rotulado e as posições editoriais não são vendidas.
      </figcaption>
      <ul className="pt-map-list" data-testid="mk-mapa-lista">
        {positions.map((p) => (
          <li key={p.id} data-position-item={p.id}>
            <strong>{p.name}</strong>: {p.dimension ? `${dimLabel(p.dimension)} px` : 'dimensões em definição'}
          </li>
        ))}
      </ul>
    </figure>
  );
}
