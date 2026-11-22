import type { Metadata } from 'next';
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
        <form className="ln-form ln-panel" method="post" action="/api/the-loyal/subscribe" style={{ maxWidth: 520 }}>
          <label htmlFor="nl-nome">Nome (opcional)</label>
          <input id="nl-nome" name="nome" autoComplete="name" />
          <label htmlFor="nl-email">E-mail</label>
          <input id="nl-email" name="email" type="email" required autoComplete="email" />
          <label style={{ fontWeight: 400 }}>
            <input type="checkbox" name="consentimento" required style={{ width: 'auto', marginRight: 8 }} />
            Concordo em receber o The Loyal e li a <a href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade</a>.
          </label>
          <button type="submit" className="ln-btn">Assinar gratuitamente</button>
          <p className="ln-meta">Consentimento específico · confirmação por e-mail · descadastro em um clique.</p>
        </form>
      ) : (
        <EmptyState title="The Loyal ainda não está aberto para inscrições">
          A newsletter está em preparação e a entrega permanece desligada até a configuração de e-mail e as regras de consentimento serem concluídas. Nenhum e-mail é coletado nesta fase.
        </EmptyState>
      )}
    </>
  );
}
