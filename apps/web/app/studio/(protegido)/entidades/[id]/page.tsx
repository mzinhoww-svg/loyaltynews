import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PUBLIC_NOTICE, studioEntityOverview } from '@ln/intelligence';
import { findModule } from '@/lib/studio/modules';
import { bancoOuNulo } from '@/lib/studio/intelligence-db';
import { requireModule } from '../../../_lib/guard';
import { SemBanco } from '../../../_components/SemBanco';

export const metadata: Metadata = { title: 'Empresa' };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EmpresaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(findModule('entidades')!);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const banco = await bancoOuNulo();
  if (!banco) return <SemBanco />;
  const ov = await studioEntityOverview(banco.db, 'organization', id);
  if (!ov || ov.kind !== 'organization') notFound();
  return (
    <>
      <p>
        <Link href="/studio/entidades">← Entity intelligence</Link>
      </p>
      <h1>{ov.organization.trade_name ?? ov.organization.legal_name}</h1>
      <p className="st-hint">{PUBLIC_NOTICE}</p>
      <h2>Pessoas na data {ov.as_of}</h2>
      {ov.people.length === 0 ? <p className="st-hint">Sem registro de pessoas.</p> : <pre>{JSON.stringify(ov.people, null, 2)}</pre>}
      <h2>Relações</h2>
      {ov.relations.length === 0 ? <p className="st-hint">Sem relações registradas.</p> : <pre>{JSON.stringify(ov.relations, null, 2)}</pre>}
      <h2>Movimentações</h2>
      {ov.moves.length === 0 ? <p className="st-hint">Sem movimentações.</p> : <pre>{JSON.stringify(ov.moves, null, 2)}</pre>}
    </>
  );
}
