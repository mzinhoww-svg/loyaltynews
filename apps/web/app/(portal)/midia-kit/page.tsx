import type { Metadata } from 'next';
import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { formatDateTime } from '../_lib/format';
import { getSource } from '../_lib/source';
import type { MetricValue } from '../_lib/types';

export const revalidate = 300;
export const metadata: Metadata = {
  title: 'Mídia kit — Anuncie',
  description: 'Mídia kit do Loyalty News: cobertura, audiência medida com origem e período, formatos publicitários e como pedir uma proposta.',
  alternates: { canonical: '/midia-kit' },
};

const STATE_LABEL = { ok: 'Atualizado', unavailable: 'Indisponível', stale: 'Desatualizado' } as const;

function Metric({ m }: { m: MetricValue }) {
  return (
    <div className="pt-metric">
      <small>{m.label}</small>
      <strong>{m.value ?? '—'}</strong>
      <small>
        {m.source}
        {m.window ? ` · ${m.window}` : ''}
        {m.collectedAt ? ` · coletado em ${formatDateTime(m.collectedAt)}` : ''}
      </small>
      {m.state !== 'ok' && <span className="pt-state">{STATE_LABEL[m.state]}</span>}
    </div>
  );
}

const FORMATS = [
  { name: 'Banner topo', size: '1280 × 150', where: 'Todas as páginas, acima do conteúdo; variante mobile' },
  { name: 'Retângulo sidebar', size: '336 × 280', where: 'Barra lateral, até 3 posições distintas' },
  { name: 'Banner entre seções', size: 'Faixa responsiva', where: 'Home, entre blocos de conteúdo' },
  { name: 'Banner dentro do artigo', size: 'Responsivo', where: 'Após parágrafo apropriado, sem quebrar citação' },
  { name: 'Banner rodapé', size: '1280 × 200', where: 'Acima do rodapé' },
  { name: 'Banner na agenda', size: 'Especificar por breakpoint', where: 'Página da agenda' },
  { name: 'Conteúdo patrocinado', size: 'Matéria rotulada', where: 'Sempre com rótulo ostensivo no card, na página, nas redes e na newsletter' },
];

export default async function MidiaKitPage() {
  const src = getSource();
  const [audience, latest, events] = await Promise.all([src.getAudience(), src.getLatest({ pageSize: 1 }), src.listEvents()]);
  const upcoming = events.filter((e) => e.status === 'validado' && new Date(e.startsAt) >= new Date()).length;
  const stamps = [...audience.realtime, ...audience.historical].map((m) => m.collectedAt).filter(Boolean) as string[];
  const last = stamps.sort().at(-1);

  return (
    <>
      <section className="pt-hero-band" aria-labelledby="mk-h">
        <p className="pt-kicker" style={{ color: 'var(--pt-signal)' }}>Mídia kit · Proposta comercial</p>
        <h1 id="mk-h">Quem decide o futuro da fidelidade precisa estar bem informado.</h1>
        <p>Conecte sua marca ao público que acompanha programas de fidelidade, bancos, varejo, companhias aéreas e tecnologia.</p>
        <p>
          <Link href="/contato" className="ln-btn ln-btn--primary">Solicitar proposta</Link>{' '}
          <a href="#audiencia" className="ln-btn ln-btn--ghost">Ver audiência ↓</a>
        </p>
        <p style={{ fontSize: 13 }}>Dados de audiência só aparecem quando medidos, com origem, período e data de coleta. Sem métricas inventadas.</p>
      </section>

      <nav aria-label="Seções do mídia kit" className="pt-chips">
        <a className="pt-chip" href="#cobertura">Sobre</a>
        <a className="pt-chip" href="#audiencia">Audiência</a>
        <a className="pt-chip" href="#formatos">Formatos</a>
        <a className="pt-chip" href="#precos">Preços</a>
      </nav>

      <section id="cobertura" className="pt-section" aria-labelledby="mk-cob">
        <h2 id="mk-cob">01 · Cobertura</h2>
        <div className="pt-metrics">
          <div className="pt-metric"><small>Matérias publicadas (acervo)</small><strong>{latest.total || '—'}</strong><small>CMS</small></div>
          <div className="pt-metric"><small>Eventos futuros verificados</small><strong>{upcoming || '—'}</strong><small>Agenda</small></div>
          <div className="pt-metric"><small>Editorias</small><strong>{EDITORIAS.length}</strong><small>Taxonomia do portal</small></div>
        </div>
        <div className="pt-scroll">
          <table className="pt-table">
            <thead><tr><th>Editoria</th><th>Escopo</th></tr></thead>
            <tbody>
              {EDITORIAS.map((e) => (
                <tr key={e.slug}><td><Link href={`/editoria/${e.slug}`}>{e.name}</Link></td><td>{e.description}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="audiencia" className="pt-section" aria-labelledby="mk-aud">
        <h2 id="mk-aud">02 · Audiência</h2>
        <h3>Tempo real</h3>
        <div className="pt-metrics">{audience.realtime.map((m) => <Metric key={m.label} m={m} />)}</div>
        <h3>Histórico</h3>
        <div className="pt-metrics">{audience.historical.map((m) => <Metric key={m.label} m={m} />)}</div>
        <p className="pt-meta" data-testid="audience-stamp">
          {last ? `Última coleta: ${formatDateTime(last)}.` : 'Atualizado: — · Aguardando integração de medição (GA4). Nenhuma métrica é exibida antes disso.'}
        </p>
      </section>

      <section className="pt-section" aria-labelledby="mk-dec">
        <h2 id="mk-dec">03 · Públicos de interesse</h2>
        <p className="pt-meta">Perfis que o portal pretende alcançar. O perfil real da audiência será comprovado com dados medidos antes de ser afirmado.</p>
        <ul className="pt-grid" style={{ listStyle: 'none', padding: 0 }}>
          {['Líderes de loyalty — estratégia e P&L', 'Bancos e fintechs — cartões, pagamentos e benefícios', 'Varejo e travel — retenção e relacionamento', 'Tecnologia e CRM — dados, plataformas e inovação'].map((t) => (
            <li key={t} className="pt-panel">{t}</li>
          ))}
        </ul>
      </section>

      <section id="formatos" className="pt-section" aria-labelledby="mk-for">
        <h2 id="mk-for">04 · Formatos e posições</h2>
        <div className="pt-scroll">
          <table className="pt-table">
            <thead><tr><th>Formato</th><th>Dimensão</th><th>Onde aparece</th></tr></thead>
            <tbody>
              {FORMATS.map((f) => <tr key={f.name}><td>{f.name}</td><td>{f.size}</td><td>{f.where}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="pt-meta">Conteúdo publicitário é sempre rotulado. Posições de ranking editorial não são vendidas.</p>
      </section>

      <section id="precos" className="pt-section" aria-labelledby="mk-pre">
        <h2 id="mk-pre">05 · Preços e disponibilidade</h2>
        <p>
          Preços de referência e disponibilidade de inventário são informados na proposta. Um formato só é vendido quando há capacidade operacional para entregá-lo.{' '}
          <Link href="/contato" style={{ textDecoration: 'underline', fontWeight: 700 }}>Fale com o comercial</Link>.
        </p>
      </section>
    </>
  );
}
