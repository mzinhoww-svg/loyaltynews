import { EmptyState } from '@ln/ui';
import type { EstadoDeLista, VazioHonesto } from '@/lib/studio/estados';

/**
 * Estado de lista honesto (design system): `erro` diz que a leitura falhou, com a mensagem do Backend e o caminho de tentar
 * de novo; `vazio` diz o que falta, por que falta e como popular. Nunca um zero apresentado como dado.
 */
export function EstadoLista({ estado, vazio, erro, recarregar, headingLevel = 2 }: { estado: EstadoDeLista; vazio?: VazioHonesto; erro: string | null; recarregar: string; headingLevel?: 2 | 3 | 4 }) {
  if (estado === 'erro') {
    return (
      <EmptyState
        kind="error"
        headingLevel={headingLevel}
        title="Não foi possível carregar a lista"
        description={
          <>
            A leitura falhou: {erro ?? 'erro sem mensagem do Backend'}. Nada foi contado nem zerado; a lista não está vazia, está ilegível.
          </>
        }
        action={
          <a className="st-btn sec" href={recarregar} data-tentar-de-novo>
            Tentar de novo
          </a>
        }
      />
    );
  }
  const texto = vazio ?? { titulo: 'Nenhum registro', porque: 'A leitura funcionou e não há registro.', comoPopular: 'Cadastre um registro pela tela do módulo.' };
  return (
    <EmptyState
      headingLevel={headingLevel}
      title={texto.titulo}
      description={
        <>
          {texto.porque} {texto.comoPopular}
        </>
      }
    />
  );
}
