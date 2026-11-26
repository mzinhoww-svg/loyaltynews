import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

/**
 * Inter variável (100–900), subset latin, auto-hospedada: um único woff2 de 48.256 B.
 * Carregada no layout RAIZ para valer no portal e no Studio. `optional` NÃO troca a fonte depois do primeiro desenho:
 * se ela não chega na janela de bloqueio, o texto fica na reserva Arial com as métricas da Inter (sem CLS); na visita
 * seguinte, com cache, a identidade aparece. Sem `preload`, a fonte não disputa banda com a imagem do LCP.
 * Decisão do PM de 25/11 (aceite-tipografia.md; substitui o swap com preload).
 */
const inter = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'optional',
  variable: '--ln-font-inter',
  preload: false,
  adjustFontFallback: 'Arial',
});

export const metadata: Metadata = {
  title: { default: 'Loyalty News', template: '%s · Loyalty News' },
  description: 'Notícias e inteligência do mercado brasileiro de fidelização.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
