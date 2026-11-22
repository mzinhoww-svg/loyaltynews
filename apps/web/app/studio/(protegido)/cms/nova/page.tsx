import type { Metadata } from 'next';
import Link from 'next/link';
import { CMS_EDIT } from '@/lib/studio/cms/roles';
import { requireStudio } from '../../../_lib/guard';
import { ArticleForm } from '../ArticleForm';

export const metadata: Metadata = { title: 'Nova matéria' };
export const dynamic = 'force-dynamic';

export default async function NovaMateria() {
  await requireStudio(CMS_EDIT);
  return (
    <>
      <p>
        <Link href="/studio/cms">← CMS editorial</Link>
      </p>
      <h1>Nova matéria</h1>
      <ArticleForm />
    </>
  );
}
