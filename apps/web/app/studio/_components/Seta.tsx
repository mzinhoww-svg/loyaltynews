/**
 * Seta dos textos do Studio: SVG, não o carácter U+2192/2190 (fora do subset latin da Inter, cairia na Arial).
 * Mesmo desenho do Arrow do portal.
 * O desenho é escondido do leitor de tela. Quando a seta SEPARA dois valores (ex.: início e fim de um período), passe `rotulo`:
 * o texto vai só para o leitor de tela ("2099-01-10 a 2099-01-20").
 */
export function Seta({ direcao = 'direita', rotulo }: { direcao?: 'direita' | 'esquerda'; rotulo?: string }) {
  const desenho = (
    <svg className="st-seta" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={direcao === 'direita' ? 'M2.5 8h11M9 3.5L13.5 8 9 12.5' : 'M13.5 8h-11M7 3.5L2.5 8 7 12.5'} />
    </svg>
  );
  if (!rotulo) return desenho;
  return (
    <span className="st-seta-rotulada">
      {desenho}
      <span className="ln-sr-only">{rotulo}</span>
    </span>
  );
}
