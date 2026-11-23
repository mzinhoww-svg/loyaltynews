// Página pública do Studio: destino de toda tentativa sem acesso. Não revela nada do painel.
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const TEXTOS: Record<string, { titulo: string; corpo: string }> = {
  NO_SESSION: { titulo: 'Acesso restrito', corpo: 'O LN Studio exige sessão. O login do Studio ainda não está disponível neste ambiente: o acesso permanece negado até a autenticação ser entregue pelo Backend.' },
  NO_MFA: { titulo: 'Verificação em duas etapas necessária', corpo: 'Sua sessão não completou a verificação em duas etapas (MFA). O acesso ao Studio foi negado.' },
  FORBIDDEN: { titulo: 'Sem permissão', corpo: 'Seu papel não tem acesso a esta área do Studio. Peça a um administrador, se isso estiver incorreto.' },
};

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const t = TEXTOS[motivo ?? ''] ?? TEXTOS.NO_SESSION!;
  return (
    <main className="st-center" id="conteudo">
      <div className="st-card">
        <h1>{t.titulo}</h1>
        <p role="alert">{t.corpo}</p>
        <p>
          <Link href="/">Voltar ao portal</Link>
        </p>
      </div>
    </main>
  );
}
