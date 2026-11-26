/**
 * Seta dos textos do Studio: SVG, não o carácter U+2192/2190 (fora do subset latin da Inter, cairia na Arial).
 * Mesmo desenho do Arrow do portal.
 */
export function Seta({ direcao = 'direita' }: { direcao?: 'direita' | 'esquerda' }) {
  return (
    <svg className="st-seta" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={direcao === 'direita' ? 'M2.5 8h11M9 3.5L13.5 8 9 12.5' : 'M13.5 8h-11M7 3.5L2.5 8 7 12.5'} />
    </svg>
  );
}
