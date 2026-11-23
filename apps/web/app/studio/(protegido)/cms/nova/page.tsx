import type { Metadata } from 'next';
import Link from 'next/link';
import { naoConfigurado } from '@/lib/studio/backend';
import { evidenciasDisponiveis } from '@/lib/studio/cms/evidencias';
import { api } from '@/lib/studio/rotas-api';
import { CMS_EDIT } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../_lib/guard';
import { SemBanco } from '../../../_components/SemBanco';
import { MateriaForm } from '../MateriaForm';

export const metadata: Metadata = { title: 'Nova matéria' };
export const dynamic = 'force-dynamic';

export default async function NovaMateria() {
  await requireStudio(CMS_EDIT);
  if (naoConfigurado(await api.fontes.listar())) return <SemBanco modulo="O CMS editorial" />;
  const evidencias = await evidenciasDisponiveis();
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>Nova matéria</h1>
      <MateriaForm evidencias={evidencias} />
    </>
  );
}
