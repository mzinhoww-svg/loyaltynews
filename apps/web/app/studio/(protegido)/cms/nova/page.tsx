import type { Metadata } from 'next';
import Link from 'next/link';
import { naoConfigurado } from '@/lib/studio/backend';
import { evidenciasDisponiveis } from '@/lib/studio/cms/evidencias';
import { api } from '@/lib/studio/rotas-api';
import { CMS_EDIT } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../_lib/guard';
import { SemBanco } from '../../../_components/SemBanco';
import { Flash } from '../../../_components/Flash';
import { FonteRapidaPainel } from '../../../_components/FonteRapidaPainel';
import { MateriaForm } from '../MateriaForm';

export const metadata: Metadata = { title: 'Nova matéria' };
export const dynamic = 'force-dynamic';

export default async function NovaMateria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStudio(CMS_EDIT);
  const q = await searchParams;
  const { tipo, aviso, fonte } = q;
  const valores = Object.fromEntries(Object.entries(q).filter(([k, v]) => /^(fr|ev)_/.test(k) && typeof v === 'string')) as Record<string, string>;
  if (naoConfigurado(await api.fontes.listar())) return <SemBanco modulo="O CMS editorial" />;
  const evidencias = await evidenciasDisponiveis();
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>Nova matéria</h1>
      <Flash tipo={tipo} aviso={aviso} />
      <div className="st-two">
        <MateriaForm evidencias={evidencias} />
        <aside aria-label="Fonte e evidência">
          <FonteRapidaPainel retorno="/studio/cms/nova" valores={valores} {...(fonte ? { fonteNova: fonte } : {})} />
        </aside>
      </div>
    </>
  );
}
