// Entrada do Studio: destino de toda tentativa sem acesso e tela de login (e-mail e senha, depois o 2º fator). Não revela nada do painel.
import Link from 'next/link';
import { destinoSeguro } from '@/lib/studio/login';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

const TEXTOS: Record<string, { titulo: string; corpo: string; alerta: boolean }> = {
  NO_SESSION: { titulo: 'Acesso restrito', corpo: 'O LN Studio exige sessão. Entre com seu e-mail e sua senha e, em seguida, com o código do aplicativo autenticador.', alerta: false },
  NO_MFA: { titulo: 'Verificação em duas etapas necessária', corpo: 'Sua sessão não completou a verificação em duas etapas (MFA). O acesso ao Studio foi negado. Entre de novo e informe o código do aplicativo autenticador.', alerta: true },
  FORBIDDEN: { titulo: 'Sem permissão', corpo: 'Seu papel não tem acesso a esta área do Studio. Peça a um administrador, se isso estiver incorreto, ou entre com outra conta.', alerta: true },
};

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ motivo?: string; retorno?: string }> }) {
  const { motivo, retorno } = await searchParams;
  const t = TEXTOS[motivo ?? ''] ?? TEXTOS.NO_SESSION!;
  return (
    <main className="st-entrada" id="conteudo">
      <div className="st-entrada__cartao" data-entrada>
        <div className="st-entrada__marca">
          {/* SVG estático da marca (sem otimização de imagem do Next) */}
          <img className="st-entrada__logo" src="/brand/logo-sobre-claro.svg" alt="Loyalty News" width={147} height={32} />
          <span className="st-entrada__produto">LN Studio</span>
        </div>
        <h1>{t.titulo}</h1>
        {t.alerta ? (
          <p className="st-entrada__texto" role="alert">
            {t.corpo}
          </p>
        ) : (
          <p className="st-entrada__texto">{t.corpo}</p>
        )}
        <LoginForm retorno={destinoSeguro(retorno)} />
        <p className="st-entrada__rodape">
          <Link href="/">Voltar ao portal</Link>
        </p>
      </div>
    </main>
  );
}
