import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchInput } from '../_components/ds-client';
import { PageHead } from '../_components/ui';
import { getSource } from '../_lib/source';
import { metadadosPagina } from '../_seo/paginas';
import s from './_components/intel.module.css';

// Sempre dinâmica: no build a fonte ainda não é 'api' e a página sairia estática e vazia; em execução (PORTAL_SOURCE=api) o Next
// recusaria a busca no-store e serviria a cópia congelada (achado no ensaio contra as rotas reais da int/011, next start).
export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return metadadosPagina({
    title: 'Loyalty Intelligence',
    description: 'Diretório público de empresas, executivos e movimentações do mercado de fidelização, com proveniência e data de atualização.',
    path: '/intelligence',
  });
}

export default async function IntelligenceHub() {
  const src = getSource();
  const [companiesDir, peopleDir, movesFeed] = await Promise.all([src.getCompanyDirectory(), src.getPeopleDirectory(), src.getMovesFeed()]);
  // Falha (indisponível), flag desligada (no go-live) e módulo disponível sem registro não são a mesma coisa: "em breve" só para o que ainda não existe.
  const rotulo = (d: { status: 'ok' | 'unavailable'; total?: number; available?: boolean }) =>
    d.status !== 'ok' ? 'Indisponível no momento'
      : d.available === false ? 'Disponível no go-live'
        : (d.total ?? 0) > 0 ? `${d.total} cadastrado(s) e verificado(s)`
          : 'Nenhum registro publicado ainda';
  const total = (d: { status: 'ok' | 'unavailable'; total?: number }) => (d.status === 'ok' ? d.total ?? 0 : null);
  const tiles = [
    { href: '/intelligence/empresas', title: 'Empresas', text: 'Diretório de companhias, programas e parceiros, com fonte e data de revisão.', rotulo: rotulo(companiesDir), n: total(companiesDir) },
    { href: '/intelligence/pessoas', title: 'Pessoas', text: 'Executivos e profissionais: apenas dados profissionais públicos, relevantes e verificáveis.', rotulo: rotulo(peopleDir), n: total(peopleDir) },
    { href: '/moves', title: 'Moves', text: 'Movimentações de cargo e de empresa confirmadas por fonte primária.', rotulo: rotulo(movesFeed), n: total(movesFeed) },
  ];
  return (
    <>
      <PageHead
        title="Loyalty Intelligence"
        lead="Portal público de inteligência do setor. Cada perfil mostra de onde vem a informação e quando foi revisada; hipóteses não confirmadas não são publicadas."
        crumbs={[{ label: 'Intelligence' }]}
      />
      <SearchInput action="/intelligence/empresas" label="Buscar no diretório" placeholder="Buscar empresa, programa ou segmento" />
      <ul className="pt-grid pt-grid-3" style={{ listStyle: 'none', padding: 0 }}>
        {tiles.map((t) => (
          <li key={t.href} className="pt-panel">
            <h2 style={{ fontSize: 22 }}><Link href={t.href} className={s.touch} data-testid={`tile-${t.title.toLowerCase()}`}>{t.title}</Link></h2>
            <p>{t.text}</p>
            <p className="pt-meta" data-testid={`count-${t.title.toLowerCase()}`} data-count={t.n ?? undefined}>
              {t.rotulo}
            </p>
          </li>
        ))}
      </ul>
      <section className="pt-panel" aria-labelledby="intel-rules">
        <h2 id="intel-rules" style={{ fontSize: 20 }}>Como tratamos os dados</h2>
        <ul>
          <li>Cada perfil traz fonte, data da última revisão e canal de correção.</li>
          <li>Hierarquia e relações não são inferidas por coocorrência em notícias.</li>
          <li>Pedidos de titular (correção, retificação, supressão) seguem a <Link href="/privacidade" className={s.touch} style={{ textDecoration: 'underline' }}>política de privacidade e LGPD</Link>.</li>
          <li>Watchlist e alertas personalizados exigem conta e estão desligados nesta fase.</li>
        </ul>
      </section>
    </>
  );
}
