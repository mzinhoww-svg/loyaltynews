import type { Metadata } from 'next';
import { Button } from '@ln/ui';
import { Input } from '../_components/ds-client';
import { EmptyState, PageHead } from '../_components/ui';
import { flags } from '../_lib/flags';

export const metadata: Metadata = {
  title: 'The Loyal — newsletter',
  description: 'The Loyal: inteligência de mercado para começar o dia.',
  alternates: { canonical: '/the-loyal' },
  robots: flags.theLoyal ? undefined : { index: false, follow: true },
};

export default function TheLoyalPage() {
  return (
    <>
      <PageHead
        title="The Loyal"
        lead="Inteligência de mercado para começar o dia: curadoria sobre fidelização, pontos, bancos, tecnologia, varejo e viagens."
        crumbs={[{ label: 'The Loyal' }]}
      />
      {flags.theLoyal ? (
        <form className="pt-panel" method="post" action="/api/the-loyal/subscribe" style={{ maxWidth: 520, display: 'grid', gap: 12 }}>
          <Input label="Nome (opcional)" name="nome" autoComplete="name" />
          <Input label="E-mail" name="email" type="email" required autoComplete="email" />
          <label>
            <input type="checkbox" name="consentimento" required style={{ marginRight: 8 }} />
            Concordo em receber o The Loyal e li a <a href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade</a>.
          </label>
          <Button type="submit">Assinar gratuitamente</Button>
          <p className="pt-meta">Consentimento específico · confirmação por e-mail · descadastro em um clique.</p>
        </form>
      ) : (
        <EmptyState title="The Loyal ainda não está aberto para inscrições">
          A inscrição na The Loyal está fechada. No pedido comercial registramos, se você marcar, o interesse na newsletter. Nada é enviado hoje.
        </EmptyState>
      )}
    </>
  );
}
