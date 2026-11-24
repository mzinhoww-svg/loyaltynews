import Link from 'next/link';
import { EmptyState, PageHead } from './_components/ui';

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
