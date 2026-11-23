import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PUBLIC_NOTICE } from '@ln/intelligence';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { nivelDoCargo, textoDaEvidencia, type CargoLinha } from '@/lib/studio/intelligence-view';
import { requireModule } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { MovesPendentes } from '../../../_components/MovesPendentes';
import { CargosAConfirmar } from '../../../_components/CargosEntidades';

export const metadata: Metadata = { title: 'Empresa' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROTULO_RELACAO: Record<string, string> = { parent_of: 'Controladora de', partner_of: 'Parceria com', supplier_of: 'Fornecedora de', coalition_member: 'Coalizão com', acquired: 'Adquiriu', other: 'Outra relação com' };

export default async function EmpresaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('entidades')!);
  const { id } = await params;
  const { tipo, aviso } = await searchParams;
  if (!UUID.test(id)) notFound();
  const r = await api.intelligence.empresa(id, { includeInferred: true });
  if (naoConfigurado(r)) return <SemBanco />;
  if (r.status === 404) notFound();
  if (ehErro(r)) {
    return (
      <div className="st-alert err" role="alert">
        {mensagemErro(r)}
      </div>
    );
  }
  const ov = r.body;
  const org = ov.organization;
  // cada cargo com a evidência dele (fonte, link, data): vem da rota da pessoa, que traz o histórico com a evidência de cada cargo
  const cargos = new Map<string, CargoLinha>();
  await Promise.all(
    ov.people.slice(0, 60).map(async (p) => {
      const ex = await api.intelligence.executivo(p.person_id, { includeInferred: true });
      if (ehErro(ex)) return;
      const aqui = ex.body.roles.find((c) => c.organization_id === id && c.title === p.title && c.valid_to === null) ?? ex.body.roles.find((c) => c.organization_id === id && c.title === p.title);
      if (aqui) cargos.set(`${p.person_id}|${p.title}`, aqui);
    }),
  );
  const podeAgir = checkAccess(session, ['admin', 'editor_chefe', 'editor']).ok;
  const podeRevisar = checkAccess(session, ['admin', 'editor_chefe', 'editor', 'revisor']).ok;
  return (
    <>
      <p>
        <Link href="/studio/entidades">← Entity intelligence</Link>
      </p>
      <h1>{org.trade_name ?? org.legal_name}</h1>
      <p className="st-hint">{PUBLIC_NOTICE}</p>
      <p className="st-hint">
        {org.kind} · fonte: <a href={org.evidence.source_url} rel="noreferrer noopener">{textoDaEvidencia(org.evidence)}</a>
      </p>
      <Flash tipo={tipo} aviso={aviso} />

      <h2>Pessoas e cargos na data {ov.as_of}</h2>
      {ov.people.length === 0 ? (
        <p className="st-hint" data-vazio="pessoas">
          Sem registro de pessoas (ausência de registro não prova inexistência).
        </p>
      ) : (
        <table className="st-table" aria-label="Pessoas e cargos">
          <thead>
            <tr>
              <th scope="col">Pessoa</th>
              <th scope="col">Cargo</th>
              <th scope="col">Nível</th>
              <th scope="col">Fonte e data</th>
            </tr>
          </thead>
          <tbody>
            {ov.people.map((p) => {
              const nivel = nivelDoCargo(p.certainty);
              const c = cargos.get(`${p.person_id}|${p.title}`);
              return (
                <tr key={`${p.person_id}-${p.title}`} data-cargo={p.title} data-nivel={nivel.chave}>
                  <th scope="row">
                    <Link href={`/studio/entidades/pessoa/${p.person_id}`}>{p.full_name}</Link>
                  </th>
                  <td>{p.title}</td>
                  <td>
                    <span className={`st-badge ${nivel.chave === 'oficial' ? 'aprovado' : 'em_checagem'}`}>{nivel.rotulo}</span>
                  </td>
                  <td>
                    {c ? (
                      <>
                        <a href={c.evidence.source_url} rel="noreferrer noopener">
                          {textoDaEvidencia(c.evidence)}
                        </a>
                        <div className="st-hint">validado em {c.validated_at.slice(0, 10)}</div>
                      </>
                    ) : (
                      <span className="st-hint">validado em {p.validated_at.slice(0, 10)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <CargosAConfirmar organizationId={id} podeAgir={podeAgir} retorno={`/studio/entidades/${id}`} />

      <h2>Relações</h2>
      {ov.relations.length === 0 ? (
        <p className="st-hint" data-vazio="relacoes">
          Sem relações registradas.
        </p>
      ) : (
        <table className="st-table" aria-label="Relações">
          <thead>
            <tr>
              <th scope="col">Relação</th>
              <th scope="col">Empresa</th>
              <th scope="col">Vigência</th>
              <th scope="col">Nível</th>
              <th scope="col">Fonte e data</th>
            </tr>
          </thead>
          <tbody>
            {ov.relations.map((x) => {
              const nivel = nivelDoCargo(x.certainty);
              return (
                <tr key={x.id} data-relacao={x.type} data-nivel={nivel.chave}>
                  <th scope="row">
                    {ROTULO_RELACAO[x.type] ?? x.type} {x.direction === 'from' ? '→' : '←'}
                  </th>
                  <td>
                    <Link href={`/studio/entidades/${x.other_org_id}`}>{x.other_org_name}</Link>
                  </td>
                  <td>
                    {x.valid_from} → {x.valid_to ?? 'em vigor'}
                  </td>
                  <td>
                    <span className={`st-badge ${nivel.chave === 'oficial' ? 'aprovado' : 'em_checagem'}`}>{nivel.rotulo}</span>
                  </td>
                  <td>
                    <a href={x.evidence.source_url} rel="noreferrer noopener">
                      {textoDaEvidencia(x.evidence)}
                    </a>
                    <div className="st-hint">validado em {x.validated_at.slice(0, 10)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <MovesPendentes organizationId={id} podeRevisar={podeRevisar} retorno={`/studio/entidades/${id}`} />
    </>
  );
}
