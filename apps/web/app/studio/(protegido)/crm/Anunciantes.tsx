import Link from 'next/link';

export type ContaCrm = { id: string; name: string; createdAt: string; leads: number; opportunities: number; campaigns: number; activeCampaigns: number };
export type ContatoCrm = { id: string; name: string; email: string; whatsapp: string | null; status: string; consentAt: string; accountId: string | null };

/** Contatos de uma conta: os leads que a conversão ligou a ela (o domínio não tem outra entidade de contato). */
export const contatosDaConta = (contaId: string, leads: ContatoCrm[]): ContatoCrm[] => leads.filter((l) => l.accountId === contaId);

/**
 * Anunciantes (contas do CRM) e contatos. Contagens vêm da lista do Backend; contatos são dado pessoal (LGPD) e só aparecem para o comercial/admin,
 * que já é o único papel com acesso a esta página.
 */
export function Anunciantes({ contas, leads, erro }: { contas: ContaCrm[]; leads: ContatoCrm[]; erro: string | null }) {
  return (
    <section aria-labelledby="h-anunciantes" data-testid="anunciantes">
      <h2 id="h-anunciantes" style={{ marginTop: 24 }}>
        Anunciantes e contatos
      </h2>
      {erro ? (
        <div className="st-alert err" role="alert" data-testid="anunciantes-erro">
          Não foi possível carregar os anunciantes: {erro}
        </div>
      ) : contas.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio-contas" data-vazio="anunciantes">
          <h3 id="vazio-contas">Nenhum anunciante</h3>
          <p>A conta do anunciante nasce quando um lead qualificado é convertido em oportunidade.</p>
        </section>
      ) : (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          {contas.map((c) => {
            const contatos = contatosDaConta(c.id, leads);
            return (
              <li key={c.id} className="st-card" style={{ marginBottom: 12 }} data-conta={c.id}>
                <h3 style={{ marginTop: 0 }}>{c.name}</h3>
                <p className="st-hint">
                  Desde {c.createdAt.slice(0, 10)} · {c.leads} lead(s) · {c.opportunities} oportunidade(s) · {c.campaigns} campanha(s), {c.activeCampaigns} ativa(s) ·{' '}
                  <Link href={`/studio/campanhas?conta=${encodeURIComponent(c.id)}`}>Campanhas de {c.name}</Link>
                </p>
                {contatos.length === 0 ? (
                  <p data-vazio="contatos">Nenhum contato ligado a esta conta.</p>
                ) : (
                  <ul aria-label={`Contatos de ${c.name}`}>
                    {contatos.map((l) => (
                      <li key={l.id} data-contato={l.id}>
                        <strong>{l.name}</strong> · <a href={`mailto:${l.email}`}>{l.email}</a> · WhatsApp: {l.whatsapp ?? '—'} · consentimento em{' '}
                        {l.consentAt.slice(0, 16).replace('T', ' ')}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
