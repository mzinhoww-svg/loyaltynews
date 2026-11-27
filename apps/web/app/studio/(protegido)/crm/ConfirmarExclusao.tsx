import { excluirLeadAction } from './actions';
import { FocarAoAbrir } from './FocarAoAbrir';

const PAINEL = 'excluir-lead';

/** Endereço que abre a confirmação (navegação comum, funciona sem JavaScript; com ele o foco vai ao painel). Só o id vai na URL. */
export const linkExcluir = (id: string, status?: string): string =>
  `/studio/crm?${new URLSearchParams({ ...(status ? { status } : {}), excluir: id })}#${PAINEL}`;

type LeadDaConfirmacao = { id: string; name: string; company: string; email: string; createdAt: string };

/** Passo de confirmação antes de apagar. Nada é apagado por abrir este painel; "Cancelar" só volta à lista. */
export function ConfirmarExclusao({ lead, erro }: { lead: LeadDaConfirmacao | undefined; erro: string | null }) {
  if (!lead) {
    return (
      <div id={PAINEL} tabIndex={-1} className="st-alert err" role="alert" data-exclusao-indisponivel>
        <FocarAoAbrir id={PAINEL} />
        {erro
          ? `Não foi possível abrir a exclusão: a leitura dos leads falhou (${erro}). Nada foi apagado.`
          : 'Esse contato não está nesta lista: ele pode já ter sido excluído. Nada foi apagado agora.'}
      </div>
    );
  }
  return (
    <section id={PAINEL} tabIndex={-1} className="st-card" style={{ marginBottom: 14 }} aria-labelledby="h-excluir-lead" data-confirmar-exclusao={lead.id}>
      <FocarAoAbrir key={lead.id} id={PAINEL} />
      <h2 id="h-excluir-lead">Excluir o contato {lead.name}?</h2>
      <p>
        <strong>{lead.name}</strong> · {lead.company} · {lead.email}
      </p>
      <p>
        A exclusão é definitiva e não pode ser desfeita: o lead sai do CRM. Se ele foi convertido, o anunciante e a oportunidade continuam, sem o vínculo com a pessoa. Um contato
        cadastrado direto no anunciante não é apagado por aqui. Fica só o registro de quem excluiu e quando, sem os dados da pessoa.
      </p>
      <form action={excluirLeadAction} className="st-actions" aria-label={`Confirmar a exclusão de ${lead.name}`}>
        <input type="hidden" name="id" value={lead.id} />
        <input type="hidden" name="criadoEm" value={lead.createdAt} />
        <input type="hidden" name="confirmar" value="sim" />
        <a className="st-btn sec" href="/studio/crm" data-cancelar>
          Cancelar
        </a>
        <button className="st-btn danger" type="submit">
          Excluir definitivamente
        </button>
      </form>
    </section>
  );
}
