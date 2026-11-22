import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import axe from "axe-core";
import "../src/styles/index.css";
import {
  AdSlot,
  ArticleCard,
  Breadcrumb,
  Button,
  Container,
  EDITORIAS,
  EditoriaBadge,
  EmptyState,
  Footer,
  Grid,
  Header,
  Input,
  Logo,
  MockBadge,
  MockFrame,
  Monogram,
  Pagination,
  SearchInput,
  SectionHeading,
  Tag,
  brandColors,
  colors,
  spacing,
  radius,
} from "../src";

/* Todo conteúdo editorial abaixo é SIMULADO (MOCK) e não representa matérias reais. */
const mock = (n: number, editoriaIdx: number) => ({
  title: `Título de exemplo ${n} — texto simulado para testar quebra de linha e hierarquia`,
  href: `#mock-${n}`,
  editoria: EDITORIAS[editoriaIdx % 10]!,
  excerpt: "Resumo simulado, usado apenas para validar espaçamento e leitura do cartão.",
  publishedAt: "2026-01-15T09:00:00-03:00",
  author: "Autor simulado",
  readingMinutes: 4,
  isMock: true,
});

const Swatch = ({ name, value }: { name: string; value: string }) => (
  <li style={{ listStyle: "none", display: "flex", alignItems: "center", gap: 12 }}>
    <span aria-hidden="true" style={{ width: 40, height: 40, background: value, border: "1px solid var(--ln-color-border-strong)", borderRadius: 8 }} />
    <span>
      <strong>{name}</strong> <code>{value}</code>
    </span>
  </li>
);

function App() {
  return (
    <div className="ln-root">
      <Header currentSlug="pontos-e-milhas" searchSlot={<SearchInput action="#busca" />} />
      <main id="conteudo">
        <Container as="section" style={{ paddingBlock: 32 }}>
          <Breadcrumb items={[{ label: "Início", href: "#" }, { label: "Design System" }]} />
          <SectionHeading level={1} eyebrow="Frente 05" title="Vitrine do Design System" description="Componentes do Loyalty News 2.1 sobre os tokens do brandkit 2.0-draft.1 (status do brandkit: proposta não aprovada)." />
          <p>
            <MockBadge label="todo conteúdo editorial desta página é simulado" />
          </p>
        </Container>

        <Container as="section" aria-labelledby="s-tokens" style={{ paddingBlock: 16 }}>
          <SectionHeading id="s-tokens" title="Tokens" />
          <Grid cols={{ base: 1, md: 2 }} gap="lg">
            <div>
              <h3>Cores da marca</h3>
              <ul style={{ padding: 0, display: "grid", gap: 8 }}>{Object.entries(brandColors).map(([k, v]) => <Swatch key={k} name={k} value={v} />)}</ul>
              <h3>Cores derivadas (extensions.json)</h3>
              <ul style={{ padding: 0, display: "grid", gap: 8 }}>
                {Object.entries(colors).filter(([k]) => !(k in brandColors)).map(([k, v]) => <Swatch key={k} name={k} value={v} />)}
              </ul>
            </div>
            <div>
              <h3>Tipografia</h3>
              <p style={{ fontFamily: "var(--ln-font-editorial)", fontSize: "var(--ln-text-3xl)", margin: 0 }}>Georgia — editorial</p>
              <p style={{ fontFamily: "var(--ln-font-ui)", fontSize: "var(--ln-text-xl)", margin: "8px 0" }}>Inter — interface</p>
              <h3>Espaçamento</h3>
              <ul style={{ padding: 0 }}>{Object.entries(spacing).filter(([k]) => k !== "0").map(([k, v]) => (
                <li key={k} style={{ listStyle: "none", display: "flex", alignItems: "center", gap: 8 }}><code style={{ width: 90 }}>space-{k} {v}</code><span aria-hidden="true" style={{ height: 8, width: v, background: "var(--ln-color-secondary)" }} /></li>
              ))}</ul>
              <h3>Raios</h3>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{Object.entries(radius).map(([k, v]) => (
                <span key={k} style={{ width: 64, height: 64, display: "grid", placeItems: "center", background: "var(--ln-color-mint)", border: "2px solid var(--ln-color-primary)", borderRadius: v, fontSize: 12 }}>{k}</span>
              ))}</div>
            </div>
          </Grid>
        </Container>

        <Container as="section" aria-labelledby="s-logo" style={{ paddingBlock: 16 }}>
          <SectionHeading id="s-logo" title="Logo e monograma" />
          <Grid cols={{ base: 1, md: 2 }}>
            <div style={{ padding: 16, background: "#fff", border: "1px solid var(--ln-color-border)" }}><Logo variant="primary" height={48} /> primary</div>
            <div style={{ padding: 16, background: "var(--ln-color-primary)" }}><Logo variant="reverse" height={48} /> <span style={{ color: "#fff" }}>reverse</span></div>
            <div style={{ padding: 16, background: "var(--ln-color-black)" }}><Logo variant="white" height={48} /> <span style={{ color: "#fff" }}>white</span></div>
            <div style={{ padding: 16, background: "var(--ln-color-mint)" }}><Logo variant="monochrome" height={48} /> monochrome</div>
            <div style={{ display: "flex", gap: 12 }}><Monogram variant="dark" size={64} /><Monogram variant="light" size={64} /></div>
          </Grid>
        </Container>

        <Container as="section" aria-labelledby="s-cards" style={{ paddingBlock: 16 }}>
          <SectionHeading id="s-cards" title="ArticleCard" eyebrow="MOCK" action={{ label: "Ver todas", href: "#cards" }} />
          <ArticleCard {...mock(1, 2)} size="lg" headingLevel={3} />
          <div style={{ height: 24 }} />
          <Grid cols={{ base: 1, md: 2, lg: 3 }} gap="lg">
            <ArticleCard {...mock(2, 3)} size="md" headingLevel={3} />
            <ArticleCard {...mock(3, 4)} size="md" headingLevel={3} />
            <ArticleCard {...mock(4, 5)} size="md" headingLevel={3} />
          </Grid>
          <div style={{ height: 24 }} />
          <Grid cols={{ base: 1, md: 2 }} gap="lg">
            <div>
              <ArticleCard {...mock(5, 6)} size="sm" headingLevel={3} />
              <ArticleCard {...mock(6, 7)} size="sm" headingLevel={3} />
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {[1, 2, 3].map((n) => (
                <li key={n}><ArticleCard {...mock(6 + n, n)} size="compact" rank={n} headingLevel={3} /></li>
              ))}
            </ol>
          </Grid>
        </Container>

        <Container as="section" aria-labelledby="s-ctrl" style={{ paddingBlock: 16 }}>
          <SectionHeading id="s-ctrl" title="Controles" />
          <Grid cols={{ base: 1, md: 2 }} gap="lg">
            <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Button>Primário</Button>
                <Button variant="secondary">Secundário</Button>
                <Button variant="ghost">Ghost</Button>
                <Button disabled>Desabilitado</Button>
                <Button href="#link" size="lg">Link-botão</Button>
              </div>
              <Input label="E-mail" hint="Exemplo de campo com dica" placeholder="voce@exemplo.com" />
              <Input label="Campo com erro" error="Mensagem de erro de exemplo" defaultValue="valor" />
              <SearchInput onSearch={() => undefined} label="Buscar (exemplo)" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Tag>Tag</Tag>
                <Tag href="#tag">Tag link</Tag>
                <EditoriaBadge editoria={EDITORIAS[0]!} />
                <EditoriaBadge editoria={EDITORIAS[1]!} asLink />
              </div>
            </div>
            <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
              <EmptyState title="Nenhuma matéria publicada nesta editoria ainda" description="Quando houver conteúdo publicado, ele aparecerá aqui." action={<Button href="#" variant="secondary">Voltar ao início</Button>} />
              <EmptyState kind="unavailable" headingLevel={3} title="Recurso ainda não ativado" description="Esta área está desligada por feature flag." />
              <EmptyState kind="error" headingLevel={3} title="Não foi possível carregar" description="Tente novamente em instantes." />
              <MockFrame label="exemplo de bloco simulado"><p style={{ margin: 0 }}>Conteúdo simulado dentro de MockFrame.</p></MockFrame>
            </div>
          </Grid>
          <div style={{ marginTop: 24 }}>
            <Pagination page={4} totalPages={20} hrefFor={(p) => `#pagina-${p}`} />
          </div>
        </Container>

        <Container as="section" aria-labelledby="s-ads" style={{ paddingBlock: 16 }}>
          <SectionHeading id="s-ads" title="AdSlot (placeholder rotulado)" />
          <AdSlot format="leaderboard" />
          <Grid cols={{ base: 1, md: 2 }}><AdSlot format="mrec" /><AdSlot format="mobile-banner" /></Grid>
        </Container>
      </main>
      <Footer year={2026} groups={[{ title: "Exemplo", links: [{ label: "Link de exemplo", href: "#exemplo" }] }]} note="Vitrine interna — não é página pública." />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Auditoria de acessibilidade no navegador real (inclui color-contrast). Abra com ?axe.
if (new URLSearchParams(location.search).has("axe")) {
  setTimeout(async () => {
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    (window as unknown as { __axe: unknown }).__axe = {
      width: innerWidth,
      violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) })),
      passes: r.passes.length,
      incomplete: r.incomplete.map((v) => v.id),
    };
    document.title = `axe: ${r.violations.length} violações`;
  }, 500);
}
