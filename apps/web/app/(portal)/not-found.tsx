import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHead } from './_components/ui';

// 404 com a marca (cabeçalho e rodapé do portal), título próprio e fora do índice de busca.
export const metadata: Metadata = { title: 'Página não encontrada', robots: { index: false, follow: true } };

export default function NotFound() {
  return (
    <>
      <PageHead title="Página não encontrada" />
      <EmptyState appearance="box" title="Não encontramos o que você procurava">
        O endereço pode ter mudado ou a matéria ainda não foi publicada. <Link href="/" className="pt-more">Voltar à página inicial</Link> ou <Link href="/busca" className="pt-more">buscar no portal</Link>.
      </EmptyState>
    </>
  );
}
