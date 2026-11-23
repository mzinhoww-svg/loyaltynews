import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PUBLIC_NOTICE } from '@ln/intelligence';
import { findModule } from '@/lib/studio/modules';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { nivelDoCargo, textoDaEvidencia } from '@/lib/studio/intelligence-view';
import { requireModule } from '../../../../_lib/guard';
import { SemBanco } from '../../../../_components/SemBanco';

export const metadata: Metadata = { title: 'Executivo' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PessoaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(findModule('entidades')!);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const r = await api.intelligence.executivo(id, { includeInferred: true });
  if (naoConfigurado(r)) return <SemBanco />;
  if (r.status === 404) notFound();
  if (ehErro(r)) {
    return (
      <div className="st-alert err" role="alert">
        {mensagemErro(r)}
      </div>
    );
  }
  const { person, roles } = r.body;
  return (
    <>
      <p>
        <Link href="/studio/entidades">← Entity intelligence</Link>
      </p>
      <h1>{person.full_name}</h1>
      <p className="st-hint">{PUBLIC_NOTICE}</p>
      <p className="st-hint">
        Identificação: {person.public_profile_url ? <a href={person.public_profile_url} rel="noreferrer noopener">perfil público</a> : 'sem perfil público registrado'} · fonte:{' '}
        <a href={person.evidence.source_url} rel="noreferrer noopener">{textoDaEvidencia(person.evidence)}</a>
      </p>
      <h2>Cargos ({roles.length})</h2>
      {roles.length === 0 ? (
        <p className="st-hint" data-vazio="cargos">
          Sem cargos registrados.
        </p>
      ) : (
        <table className="st-table" aria-label="Cargos">
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col">Cargo</th>
              <th scope="col">Vigência</th>
              <th scope="col">Nível</th>
              <th scope="col">Fonte e data</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((c) => {
              const nivel = nivelDoCargo(c.certainty);
              return (
                <tr key={c.role_id} data-cargo={c.title} data-nivel={nivel.chave}>
                  <th scope="row">
                    <Link href={`/studio/entidades/${c.organization_id}`}>{c.organization}</Link>
                  </th>
                  <td>{c.title}</td>
                  <td>
                    {c.valid_from} → {c.valid_to ?? 'em vigor'}
                  </td>
                  <td>
                    <span className={`st-badge ${nivel.chave === 'oficial' ? 'aprovado' : 'em_checagem'}`}>{nivel.rotulo}</span>
                  </td>
                  <td>
                    <a href={c.evidence.source_url} rel="noreferrer noopener">
                      {textoDaEvidencia(c.evidence)}
                    </a>
                    <div className="st-hint">validado em {c.validated_at.slice(0, 10)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
