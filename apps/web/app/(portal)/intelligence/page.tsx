import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHead } from '../_components/ui';
import { getSource } from '../_lib/source';

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'Loyalty Intelligence',
  description: 'Diretório público de empresas, executivos e movimentações do mercado de fidelização, com proveniência e data de atualização.',
  alternates: { canonical: '/intelligence' },
};

export default async function IntelligenceHub() {
  const src = getSource();
  const [companies, people, moves] = await Promise.all([src.listCompanies(), src.listPeople(), src.listMoves()]);
  const tiles = [
    { href: '/intelligence/empresas', title: 'Empresas', text: 'Diretório de companhias, programas e parceiros, com fonte e data de revisão.', n: companies.length },
    { href: '/intelligence/pessoas', title: 'Pessoas', text: 'Executivos e profissionais: apenas dados profissionais públicos, relevantes e verificáveis.', n: people.length },
    { href: '/moves', title: 'Moves', text: 'Movimentações de cargo e de empresa confirmadas por fonte primária.', n: moves.length },
  ];
  return (
    <>
      <PageHead
        title="Loyalty Intelligence"
        lead="Portal público de inteligência do setor. Cada perfil mostra de onde vem a informação e quando foi revisada; hipóteses não confirmadas não são publicadas."
        crumbs={[{ label: 'Intelligence' }]}
      />
      <form role="search" action="/intelligence/empresas" method="get" className="ln-searchbar" aria-label="Buscar no diretório">
        <label htmlFor="iq" className="ln-skip" style={{ position: 'absolute' }}>Buscar empresa, programa ou segmento</label>
        <input id="iq" name="q" type="search" placeholder="Buscar empresa, programa ou segmento" autoComplete="off" />
        <button type="submit" className="ln-btn">Buscar</button>
      </form>
      <ul className="ln-grid ln-grid-3" style={{ listStyle: 'none', padding: 0 }}>
        {tiles.map((t) => (
          <li key={t.href} className="ln-panel">
            <h2 style={{ fontSize: 22 }}><Link href={t.href}>{t.title}</Link></h2>
            <p>{t.text}</p>
            <p className="ln-meta" data-testid={`count-${t.title.toLowerCase()}`}>
              {t.n > 0 ? `${t.n} cadastrado(s) e verificado(s)` : 'Cadastros verificados: em breve'}
            </p>
          </li>
        ))}
      </ul>
      <section className="ln-panel" aria-labelledby="intel-rules">
        <h2 id="intel-rules" style={{ fontSize: 20 }}>Como tratamos os dados</h2>
        <ul>
          <li>Cada perfil traz fonte, data da última revisão e canal de correção.</li>
          <li>Hierarquia e relações não são inferidas por coocorrência em notícias.</li>
          <li>Pedidos de titular (correção, retificação, supressão) seguem a <Link href="/privacidade" style={{ textDecoration: 'underline' }}>política de privacidade e LGPD</Link>.</li>
          <li>Watchlist e alertas personalizados exigem conta e estão desligados nesta fase.</li>
        </ul>
      </section>
    </>
  );
}
