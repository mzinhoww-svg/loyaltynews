import type { Metadata } from 'next';
import PortalLayout from './(portal)/layout';
import PortalNotFound from './(portal)/not-found';

/**
 * 404 raiz: endereço de vários níveis que não casa com nenhuma rota (ex.: /x/y/z) caía no 404 padrão do Next, em inglês e sem a marca
 * (o (portal)/not-found só cobre o que está dentro do layout do portal, e o [doc] do portal só pega um nível). Aqui o mesmo 404 do
 * portal, dentro do layout do portal (cabeçalho, rodapé e CSS), fora do índice.
 */
export const metadata: Metadata = { title: { absolute: 'Página não encontrada | Loyalty News' }, robots: { index: false, follow: true } };

export default function RootNotFound() {
  return (
    <PortalLayout>
      <PortalNotFound />
    </PortalLayout>
  );
}
