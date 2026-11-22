import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHead } from '../_components/ui';
import { INFO_DOCS, INFO_SLUGS } from '../_lib/institutional';

type Props = { params: Promise<{ doc: string }> };


export function generateStaticParams() {
  return INFO_SLUGS.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { doc } = await params;
  const d = INFO_DOCS[doc];
  if (!d) return {};
  return { title: d.title, description: d.lead, alternates: { canonical: `/${d.slug}` } };
}

export default async function InfoPage({ params }: Props) {
  const { doc } = await params;
  const d = INFO_DOCS[doc];
  if (!d) notFound();
  return (
    <article className="ln-article">
      <PageHead title={d.title} lead={d.lead} crumbs={[{ label: d.title }]} />
      {d.draftNotice && (
        <p className="ln-panel" role="note" data-testid="draft-notice">
          <strong>Minuta.</strong> {d.draftNotice}
        </p>
      )}
      {d.sections.map((s) => (
        <section key={s.heading} className="ln-section" style={{ margin: '24px 0' }}>
          <h2>{s.heading}</h2>
          {s.paragraphs?.map((p) => <p key={p}>{p}</p>)}
          {s.items && (
            <ul>
              {s.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          )}
        </section>
      ))}
      {d.slug === 'sobre' && (
        <p>
          <Link href="/metodologia" className="ln-more">Metodologia →</Link>{' '}
          <Link href="/politica-editorial" className="ln-more">Política editorial →</Link>{' '}
          <Link href="/correcoes" className="ln-more">Correções →</Link>
        </p>
      )}
      {d.slug === 'publicidade' && (
        <p><Link href="/midia-kit" className="ln-btn">Ver mídia kit</Link></p>
      )}
    </article>
  );
}
