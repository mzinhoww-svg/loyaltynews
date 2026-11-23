import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@ln/ui/styles.css';
import './studio.css';

// O Studio nunca é indexado nem aparece em sitemap.
export const metadata: Metadata = {
  title: { default: 'LN Studio', template: '%s · LN Studio' },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function StudioRootLayout({ children }: { children: ReactNode }) {
  return <div className="studio">{children}</div>;
}
