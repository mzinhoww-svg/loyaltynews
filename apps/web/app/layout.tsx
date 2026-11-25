import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

/**
 * Inter variável (100–900), subset latin, auto-hospedada: um único woff2 de 48.256 B.
 * Carregada no layout RAIZ para valer no portal e no Studio; `preload` adianta o download (antes ela só começava depois do CSS,
 * e o swap a 768 px custava CLS 0,399) e `swap` mantém o texto visível. `adjustFontFallback: 'Arial'` gera a reserva com as
 * métricas da Inter, para a troca não mudar a quebra de linha. Decisão do UI/UX de 25/11 (auditoria-design/tipografia).
 */
const inter = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--ln-font-inter',
  preload: true,
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
