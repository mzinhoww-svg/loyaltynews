import type { Metadata } from 'next';
import Link from 'next/link';
import { searchCompaniesHandler, studioOrgChart } from '@ln/intelligence';
import { findModule } from '@/lib/studio/modules';
import { bancoOuNulo } from '@/lib/studio/intelligence-db';
import { requireModule } from '../../_lib/guard';
import { OrigemBanco, SemBanco } from '../../_components/SemBanco';

export const metadata: Metadata = { title: 'Organogramas' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

type Aresta = { certainty: string; display_label?: string; [k: string]: unknown };

export default async function OrganogramasPage({ searchParams }: { searchParams: Promise<{ q?: string; org?: string; asOf?: string }> }) {
  await requireModule(findModule('organogramas')!);
  const { q = '', org = '', asOf = '' } = await searchParams;
  const banco = await bancoOuNulo();
  return (
    <>
      <h1>Organogramas</h1>
      <p>Organograma temporal com evidência por vínculo. Aresta inferida nunca é mostrada como fato: aparece rotulada &quot;inferido — não confirmado&quot;.</p>
      {!banco ? (
        <SemBanco />
      ) : (
        <>
          <OrigemBanco origem={banco.origem} />
          <form className="st-filters" method="get" role="search" aria-label="Buscar empresa">
            <div className="st-field">
              <label htmlFor="q">Buscar empresa</label>
              <input id="q" name="q" type="search" defaultValue={q} />
            </div>
            <button className="st-btn sec" type="submit">
              Buscar
            </button>
          </form>
          {q ? <Busca db={banco.db} q={q} /> : null}
          {org ? <Chart db={banco.db} org={org} asOf={asOf} /> : !q ? <p className="st-hint">Busque uma empresa para ver o organograma.</p> : null}
        </>
      )}
    </>
  );
}

async function Busca({ db, q }: { db: Parameters<typeof searchCompaniesHandler>[0]; q: string }) {
  const r = await searchCompaniesHandler(db, { q });
  if (r.status >= 400) return <div className="st-alert err" role="alert">Busca inválida.</div>;
  const items = ((r.body as { items?: { id: string; legal_name: string; trade_name: string | null }[] }).items ?? []);
  if (items.length === 0) {
    return (
      <section className="st-empty" aria-labelledby="sem-emp">
        <h2 id="sem-emp">Nenhuma empresa encontrada</h2>
        <p>Ausência de registro não prova inexistência.</p>
      </section>
    );
  }
  return (
    <ul aria-label="Empresas encontradas">
      {items.map((e) => (
        <li key={e.id}>
          <Link href={`/studio/organogramas?org=${e.id}`}>{e.trade_name ?? e.legal_name}</Link>
        </li>
      ))}
    </ul>
  );
}

async function Chart({ db, org, asOf }: { db: Parameters<typeof studioOrgChart>[0]; org: string; asOf: string }) {
  if (!UUID.test(org) || (asOf && !DATA.test(asOf))) return <div className="st-alert err" role="alert">Parâmetros inválidos.</div>;
  const c = await studioOrgChart(db, org, asOf || undefined);
  const edges = c.edges as unknown as Aresta[];
  return (
    <section aria-labelledby="chart">
      <h2 id="chart">Organograma em {c.as_of}</h2>
      <p>
        {c.declared} aresta(s) declarada(s) · {c.inferred} inferida(s)
      </p>
      {edges.length === 0 ? (
        <p className="st-hint" data-vazio="orgchart">
          Sem arestas registradas para esta data.
        </p>
      ) : (
        <ul>
          {edges.map((e, i) => (
            <li key={i}>
              {e.certainty === 'inferred' ? <strong>{e.display_label ?? 'inferido — não confirmado'}: </strong> : null}
              <code>{JSON.stringify(e)}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
