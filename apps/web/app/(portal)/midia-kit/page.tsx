import type { Metadata } from 'next';
import Link from 'next/link';
import { EDITORIAS } from '../_lib/editorias';
import { formatDateTime } from '../_lib/format';
import { PositionMap } from '../_components/PositionMap';
import { ScrollRegion } from '../_components/ScrollRegion';
import { MockTag } from '../_components/ui';
import { PUBLIC_POSITIONS, apiCoverageCards, coverageCards, fetchMediaKit, portalApiBase, type MediaKitFormat } from '../_lib/commercial-source';
import { getSource } from '../_lib/source';
import type { MetricValue } from '../_lib/types';

export const revalidate = 300;
export const metadata: Metadata = {
  title: 'Mídia kit — Anuncie',
  description: 'Mídia kit do Loyalty News: cobertura, audiência medida com origem e período, formatos publicitários e como pedir uma proposta.',
  alternates: { canonical: '/midia-kit' },
};

const STATE_LABEL = { ok: 'Atualizado', unavailable: 'Indisponível', stale: 'Desatualizado' } as const;
const STATUS_LABEL = { disponivel: 'Disponível', sob_consulta: 'Sob consulta', indisponivel: 'Indisponível' } as const;

function bySection(formats: MediaKitFormat[]): [string, MediaKitFormat[]][] {
  const m = new Map<string, MediaKitFormat[]>();
  for (const f of formats) m.set(f.section, [...(m.get(f.section) ?? []), f]);
  return [...m.entries()];
}

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
  // Em modo api, audiência e catálogo vêm da API comercial (origem, janela e data em cada número). Falha => estado vazio honesto.
  const kit = src.kind === 'api' ? await fetchMediaKit(portalApiBase()) : null;
  const [audience, latest, events] = await Promise.all([kit ? Promise.resolve(kit.audience) : src.getAudience(), src.getLatest({ pageSize: 1 }), src.listEvents()]);
  const upcoming = events.filter((e) => e.status === 'validado' && new Date(e.startsAt) >= new Date()).length;
  const stamps = [...audience.realtime, ...audience.historical].map((m) => m.collectedAt).filter(Boolean) as string[];
  const last = stamps.sort().at(-1);
  // Em modo api a cobertura vem SÓ da coleta da API comercial (origem, janela, data); a contagem ao vivo da listagem não entra: em staging
  // ela inclui o seed de demonstração e métrica comercial só conta conteúdo real.
  const cards = src.kind === 'api' ? apiCoverageCards(kit, EDITORIAS.length) : coverageCards({ kind: src.kind, articles: latest.total, events: upcoming, editorias: EDITORIAS.length });

  return (
    <>
      <section className="pt-hero-band pt-hero-band--mk" aria-labelledby="mk-h">
        <p className="pt-kicker pt-kicker--signal">Mídia kit · Proposta comercial</p>
        <h1 id="mk-h">Quem decide o futuro da fidelidade precisa estar bem informado.</h1>
        <p>Conecte sua marca ao público que acompanha programas de fidelidade, bancos, varejo, companhias aéreas e tecnologia.</p>
        <p>
          <Link href="/contato" className="ln-btn ln-btn--primary" data-testid="mk-cta-primary">Solicitar proposta</Link>{' '}
          <a href="#audiencia" className="ln-btn ln-btn--ghost" data-testid="mk-cta-secondary">Ver audiência ↓</a>
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
          {cards.map((c) => (
            <div className="pt-metric" key={c.key} data-testid={`coverage-${c.key}`} data-mock={c.mock ? 'true' : 'false'}>
              <small>{c.label}</small>
              <strong>
                {c.value ?? '—'}
                {c.mock && <> <MockTag /></>}
              </strong>
              <small>
                {c.origin}
                {c.window ? ` · ${c.window}` : ''}
                {c.checkedAt ? ` · coletado em ${formatDateTime(c.checkedAt)}` : ''}
                {c.stale ? ' · desatualizado' : ''}
                {c.value === null && c.key !== 'editorias' ? ' · sem dado real' : ''}
              </small>
            </div>
          ))}
        </div>
        <ScrollRegion label="Editorias do portal e escopo">
          <table className="pt-table">
            <thead><tr><th>Editoria</th><th>Escopo</th></tr></thead>
            <tbody>
              {EDITORIAS.map((e) => (
                <tr key={e.slug}><td><Link href={`/editoria/${e.slug}`} className="pt-tap">{e.name}</Link></td><td>{e.description}</td></tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
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
        <PositionMap positions={kit?.positions.length ? kit.positions : PUBLIC_POSITIONS} />
        <ScrollRegion label="Formatos e posições: dimensão e onde aparece">
          <table className="pt-table">
            <thead><tr><th>Formato</th><th>Dimensão</th><th>Onde aparece</th></tr></thead>
            <tbody>
              {FORMATS.map((f) => <tr key={f.name}><td>{f.name}</td><td>{f.size}</td><td>{f.where}</td></tr>)}
            </tbody>
          </table>
        </ScrollRegion>
        <p className="pt-meta">Conteúdo publicitário é sempre rotulado. Posições de ranking editorial não são vendidas.</p>
      </section>

      <section id="precos" className="pt-section" aria-labelledby="mk-pre">
        <h2 id="mk-pre">05 · Preços e disponibilidade</h2>
        <p>
          Preços de referência e disponibilidade de inventário são informados na proposta. Um formato só é vendido quando há capacidade operacional para entregá-lo.{' '}
          <Link href="/contato" style={{ textDecoration: 'underline', fontWeight: 700 }}>Fale com o comercial</Link>.
        </p>
        {kit && kit.formats.length > 0 && (
          <div data-testid="mk-precos">
            <p className="pt-meta">Valores de referência por formato, ajustáveis; confirmados na proposta. Um formato só é vendido quando está disponível.</p>
            {bySection(kit.formats).map(([section, rows]) => (
              <ScrollRegion key={section} label={`Preços de referência: ${section}`}>
                <table className="pt-table">
                  <caption>{section}</caption>
                  <thead><tr><th>Formato</th><th>Referência</th><th>Escopo</th><th>Disponibilidade</th></tr></thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.id}><td>{f.name}</td><td>{f.price}</td><td>{f.scope}</td><td>{STATUS_LABEL[f.status]}</td></tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            ))}
            {kit.integrityNote && <p className="pt-meta" role="note" data-testid="mk-integridade">{kit.integrityNote}</p>}
          </div>
        )}
      </section>
    </>
  );
}
