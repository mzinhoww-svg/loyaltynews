// Minha conta: o usuário logado troca a própria senha. Qualquer papel do Studio, sempre com sessão e 2º fator (guard).
import type { Metadata } from 'next';
import { ROLES } from '@ln/auth';
import { requireStudio } from '../../_lib/guard';
import { TrocarSenhaForm } from './TrocarSenhaForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Minha conta' };

export default async function ContaPage() {
  const { session } = await requireStudio(ROLES);
  return (
    <>
      <h1>Minha conta</h1>
      <p className="st-hint">
        Conta: <strong>{session.email ?? session.userId}</strong>
      </p>
      <section aria-labelledby="trocar-senha">
        <h2 id="trocar-senha">Trocar senha</h2>
        <p>
          A nova senha precisa ter pelo menos 12 caracteres e ser diferente da atual. Ao trocar, as suas outras sessões (outros navegadores e aparelhos) são encerradas; esta continua aberta.
        </p>
        <TrocarSenhaForm />
      </section>
    </>
  );
}
