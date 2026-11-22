import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPackage } from '@ln/growth/dashboard';
import { PackageCard } from '@ln/growth/ui';
import { findModule } from '@/lib/studio/modules';
import { socialCaller, socialDeps } from '@/lib/studio/social';
import { requireModule } from '../../../_lib/guard';

export const metadata: Metadata = { title: 'Pacote social' };
export const dynamic = 'force-dynamic';

export default async function PacotePage({ params }: { params: Promise<{ id: string }> }) {
  const { session } = await requireModule(findModule('social')!);
  const id = decodeURIComponent((await params).id);
  const r = await getPackage(socialDeps(), socialCaller(session), id);
  if (r.status === 404 || r.status === 400) notFound();
  if (r.status !== 200 || !('articleId' in r.body)) throw new Error('falha ao carregar o pacote');
  return (
    <>
      <p>
        <Link href="/studio/social">← Social dashboard</Link>
      </p>
      <h1>Pacote social</h1>
      <PackageCard record={r.body} />
    </>
  );
}
