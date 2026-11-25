import { EmptyState } from '@ln/ui';

export function SemBanco({ modulo = 'Este módulo' }: { modulo?: string }) {
  return (
    <EmptyState
      kind="unavailable"
      title="Banco de dados não configurado"
      description={`${modulo} lê do PostgreSQL pelas rotas do Backend. Neste ambiente não há DATABASE_URL, então não há dados para mostrar. Nada é simulado.`}
    />
  );
}

export function OrigemBanco({ origem }: { origem: string }) {
  return origem === 'pglite-memoria' ? (
    <p className="st-hint" role="note">
      Banco temporário em memória (PGlite, só desenvolvimento/e2e): os dados somem ao reiniciar. Em produção o Studio usa DATABASE_URL.
    </p>
  ) : null;
}

/** Módulo sem rota no Backend: o que a tela guarda vive na memória do processo do Studio. Dizer isso na tela, nunca esconder. */
export function SemRotaBackend({ o_que }: { o_que: string }) {
  return (
    <p className="st-hint" role="note" data-origem="memoria-do-processo">
      {o_que} Ainda não há rota deste módulo no Backend: o que for registrado aqui fica na memória do processo do Studio e some ao reiniciar. Nada é inventado.
    </p>
  );
}
