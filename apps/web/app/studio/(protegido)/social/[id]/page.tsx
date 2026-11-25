import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SocialPackageRecord } from '@ln/growth/dashboard';
import { PackageCard } from '@ln/growth/ui';
import { dispatchSocial } from '@/app/api/_lib/social';
import { chamar, ehErro, mensagemErro, naoConfigurado } from '@/lib/studio/backend';
import { checkAccess, findModule } from '@/lib/studio/modules';
import { requireModule } from '../../../_lib/guard';
import { Flash } from '../../../_components/Flash';
import { SemBanco } from '../../../_components/SemBanco';
import { publicarSimuladoAction } from '../actions';
import { Seta } from '../../../_components/Seta';

export const metadata: Metadata = { title: 'Pacote social' };
export const dynamic = 'force-dynamic';

export default async function PacotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tipo?: string; aviso?: string }> }) {
  const { session } = await requireModule(findModule('social')!);
  const id = decodeURIComponent((await params).id);
  const { tipo, aviso } = await searchParams;
  const r = await chamar<SocialPackageRecord>(dispatchSocial, `/api/studio/social/packages/${encodeURIComponent(id)}`);
  if (naoConfigurado(r)) return <SemBanco modulo="O Social dashboard" />;
  if (r.status === 404 || r.status === 400) notFound();
  if (ehErro(r)) throw new Error(mensagemErro(r));
  const rec = r.body as SocialPackageRecord;
  const podePublicar = checkAccess(session, ['admin', 'editor_chefe']).ok && rec.status === 'gerado';
  return (
    <>
      <p>
        <Link href="/studio/social"><Seta direcao="esquerda" /> Social dashboard</Link>
      </p>
      <h1>Pacote social</h1>
      <Flash tipo={tipo} aviso={aviso} />
      <PackageCard record={rec} />
      {podePublicar ? (
        <form action={publicarSimuladoAction} style={{ marginTop: 14 }}>
          <input type="hidden" name="id" value={rec.id} />
          <button className="st-btn sec" type="submit">
            Pedir publicação simulada
          </button>
          <p className="st-hint">Gera um recibo SIM-… e uma entrada de auditoria. Não envia nada ao mLabs.</p>
        </form>
      ) : null}
    </>
  );
}
