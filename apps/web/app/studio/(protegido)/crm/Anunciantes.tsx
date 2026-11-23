import Link from 'next/link';
import type { ContatoConta } from '@/lib/studio/rotas-api';
import { adicionarContatoAction, criarContaAction } from './actions';

export type ContaCrm = { id: string; name: string; createdAt: string; leads: number; opportunities: number; campaigns: number; activeCampaigns: number };
export type ContatoCrm = { id: string; name: string; email: string; whatsapp: string | null; status: string; consentAt: string; accountId: string | null };

/** Leads que a conversão ligou à conta (origem: formulário do mídia kit ou registro manual de lead). */
export const contatosDaConta = (contaId: string, leads: ContatoCrm[]): ContatoCrm[] => leads.filter((l) => l.accountId === contaId);

const BASES: Record<string, string> = { consentimento: 'Consentimento', legitimo_interesse: 'Legítimo interesse', execucao_de_contrato: 'Execução de contrato' };
const hora = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/**
 * Anunciantes (contas do CRM) e contatos. Contagens vêm da lista do Backend. Contatos são dado pessoal (LGPD): só comercial/admin, únicos papéis desta página.
 * Dois tipos de contato, ambos do Backend: os diretos da conta (com base legal) e os leads convertidos nela.
 */
export function Anunciantes(props: {
  contas: ContaCrm[];
  leads: ContatoCrm[];
  diretos: Record<string, { data: ContatoConta[] } | { erro: string }>;
  erro: string | null;
}) {
  const { contas, leads, diretos, erro } = props;
  return (
    <section aria-labelledby="h-anunciantes" data-testid="anunciantes">
      <h2 id="h-anunciantes" style={{ marginTop: 24 }}>
        Anunciantes e contatos
      </h2>
      <form action={criarContaAction} aria-label="Novo anunciante" className="st-actions" style={{ marginBottom: 12 }}>
        <div className="st-field">
          <label htmlFor="conta-nome">Nome do anunciante (obrigatório)</label>
          <input id="conta-nome" name="nome" type="text" maxLength={400} />
        </div>
        <button className="st-btn" type="submit">
          Criar anunciante
        </button>
      </form>
      {erro ? (
        <div className="st-alert err" role="alert" data-testid="anunciantes-erro">
          Não foi possível carregar os anunciantes: {erro}
        </div>
      ) : contas.length === 0 ? (
        <section className="st-empty" aria-labelledby="vazio-contas" data-vazio="anunciantes">
          <h3 id="vazio-contas">Nenhum anunciante</h3>
          <p>Crie o anunciante acima ou converta um lead qualificado em oportunidade.</p>
        </section>
      ) : (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          {contas.map((c) => {
            const viaLead = contatosDaConta(c.id, leads);
            const d = diretos[c.id];
            const lista = d && 'data' in d ? d.data : [];
            return (
              <li key={c.id} className="st-card" style={{ marginBottom: 12 }} data-conta={c.id}>
                <h3 style={{ marginTop: 0 }}>{c.name}</h3>
                <p className="st-hint">
                  Desde {c.createdAt.slice(0, 10)} · {c.leads} lead(s) · {c.opportunities} oportunidade(s) · {c.campaigns} campanha(s), {c.activeCampaigns} ativa(s) ·{' '}
                  <Link href={`/studio/campanhas?conta=${encodeURIComponent(c.id)}`}>Campanhas de {c.name}</Link> ·{' '}
                  <Link href={`/studio/crm/anunciantes/${encodeURIComponent(c.id)}`}>Relatório de {c.name}</Link>
                </p>
                {d && 'erro' in d ? (
                  <p className="st-alert err" role="alert">
                    Contatos diretos indisponíveis: {d.erro}
                  </p>
                ) : null}
                {lista.length === 0 && viaLead.length === 0 ? (
                  <p data-vazio="contatos">Nenhum contato ligado a esta conta.</p>
                ) : (
                  <ul aria-label={`Contatos de ${c.name}`}>
                    {lista.map((k) => (
                      <li key={k.id} data-contato={k.id} data-origem="direto">
                        <strong>{k.name}</strong>
                        {k.role ? ` (${k.role})` : ''} · <a href={`mailto:${k.email}`}>{k.email}</a> · WhatsApp: {k.whatsapp ?? '—'} · base legal: {BASES[k.basis] ?? k.basis} ·
                        registrado em {hora(k.consentAt)}
                      </li>
                    ))}
                    {viaLead.map((l) => (
                      <li key={l.id} data-contato={l.id} data-origem="lead">
                        <strong>{l.name}</strong> · <a href={`mailto:${l.email}`}>{l.email}</a> · WhatsApp: {l.whatsapp ?? '—'} · lead convertido, consentimento em {hora(l.consentAt)}
                      </li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary>Adicionar contato a {c.name}</summary>
                  <form action={adicionarContatoAction} aria-label={`Novo contato de ${c.name}`} style={{ marginTop: 8 }}>
                    <input type="hidden" name="conta" value={c.id} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      <div className="st-field">
                        <label htmlFor={`ct-nome-${c.id}`}>Nome do contato (obrigatório)</label>
                        <input id={`ct-nome-${c.id}`} name="nome" type="text" maxLength={400} />
                      </div>
                      <div className="st-field">
                        <label htmlFor={`ct-email-${c.id}`}>Email do contato (obrigatório)</label>
                        <input id={`ct-email-${c.id}`} name="email" type="text" inputMode="email" maxLength={400} />
                      </div>
                      <div className="st-field">
                        <label htmlFor={`ct-wa-${c.id}`}>WhatsApp do contato</label>
                        <input id={`ct-wa-${c.id}`} name="whatsapp" type="text" maxLength={80} />
                      </div>
                      <div className="st-field">
                        <label htmlFor={`ct-cargo-${c.id}`}>Cargo</label>
                        <input id={`ct-cargo-${c.id}`} name="cargo" type="text" maxLength={400} />
                      </div>
                      <div className="st-field">
                        <label htmlFor={`ct-base-${c.id}`}>Base legal (obrigatória)</label>
                        <select id={`ct-base-${c.id}`} name="base" defaultValue="">
                          <option value="">Escolha</option>
                          {Object.entries(BASES).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button className="st-btn" type="submit" style={{ marginTop: 8 }}>
                      Registrar contato
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
