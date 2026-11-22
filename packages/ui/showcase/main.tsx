import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import axe from "axe-core";
import "../src/styles/index.css";
import {
  AdSlot,
  ArticleCard,
  Breadcrumb,
  Button,
  Container,
  DataTable,
  type DataTableColumn,
  Drawer,
  EDITORIAS,
  EditoriaBadge,
  EmptyState,
  Footer,
  Form,
  FormField,
  Grid,
  Header,
  Input,
  KpiCard,
  Logo,
  Modal,
  MockBadge,
  MockFrame,
  Monogram,
  Pagination,
  SearchInput,
  SectionHeading,
  Sidebar,
  StatusPill,
  Tabs,
  Tag,
  TemplateImage,
  ToastProvider,
  renderCover,
  renderLowerThird,
  renderThumbnail,
  renderVignette,
  rules,
  useToast,
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


interface Fila { id: string; titulo: string; editoria: string; estado: string; palavras: number | null }
const FILA: Fila[] = Array.from({ length: 14 }, (_, i) => ({
  id: String(i), titulo: `Pauta simulada ${String(i + 1).padStart(2, "0")}`, editoria: EDITORIAS[i % 10]!.nome,
  estado: ["Novo", "Revisão", "Agendado", "Bloqueado"][i % 4]!, palavras: i % 5 === 0 ? null : 300 + i * 37,
}));
const TONE: Record<string, "neutral" | "info" | "success" | "danger"> = { Novo: "neutral", Revisão: "info", Agendado: "success", Bloqueado: "danger" };
const COLS: DataTableColumn<Fila>[] = [
  { id: "titulo", header: "Título", value: (r) => r.titulo, sortable: true },
  { id: "editoria", header: "Editoria", value: (r) => r.editoria, filterable: true },
  { id: "estado", header: "Estado", value: (r) => r.estado, filterable: true, cell: (r) => <StatusPill label={r.estado} tone={TONE[r.estado]} /> },
  { id: "palavras", header: "Palavras", value: (r) => r.palavras, sortable: true, align: "end" },
];

function ToastDemo() {
  const { push } = useToast();
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button variant="secondary" onClick={() => push({ title: "Rascunho salvo", description: "Exemplo de toast informativo.", tone: "success" })}>Toast sucesso</Button>
      <Button variant="secondary" onClick={() => push({ title: "Falha ao salvar", description: "Exemplo de erro (não fecha sozinho).", tone: "danger" })}>Toast erro</Button>
    </div>
  );
}

function StudioDemo() {
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  return (
    <Container as="section" aria-labelledby="s-studio" style={{ paddingBlock: 16 }}>
      <SectionHeading id="s-studio" title="LN Studio" eyebrow="MOCK" />
      <p><MockBadge label="indicadores e linhas abaixo são simulados" /></p>
      <Grid cols={{ base: 1, md: 2, lg: 4 }} gap="md">
        <KpiCard label="Matérias na fila" value={14} source="fixture (simulado)" period="demonstração" isMock />
        <KpiCard label="Audiência" value={null} source="GA4 (não conectado)" period="30 dias" />
        <KpiCard label="Itens bloqueados" value={4} source="fixture (simulado)" period="demonstração" isMock delta={{ text: "+1", direction: "up" }} />
        <KpiCard label="Sem origem" value={99} source="" period="7 dias" />
      </Grid>
      <div style={{ height: 24 }} />
      <Tabs label="Exemplos do Studio" tabs={[
        { id: "t", label: "Tabela", content: <DataTable caption="Fila editorial (simulada)" columns={COLS} rows={FILA} rowKey={(r) => r.id} pageSize={5} isMock /> },
        { id: "f", label: "Formulário", content: (
          <div style={{ maxWidth: 520 }}>
            <Form initialValues={{ nome: "", url: "", tipo: "web", nota: "" }} onSubmit={() => undefined} submitLabel="Salvar fonte">
              <FormField name="nome" label="Nome da fonte" required rules={[rules.minLength(3)]} hint="Como aparece na lista" />
              <FormField name="url" label="URL" type="url" rules={[rules.url()]} />
              <FormField name="tipo" label="Tipo" as="select" options={[{ value: "web", label: "Site" }, { value: "rss", label: "RSS" }]} />
              <FormField name="nota" label="Observação" as="textarea" />
            </Form>
          </div>
        ) },
        { id: "o", label: "Sobreposições", content: (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => setModal(true)}>Abrir modal</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>Abrir drawer</Button>
            <ToastDemo />
          </div>
        ) },
      ]} />
      <Modal open={modal} onClose={() => setModal(false)} title="Confirmar ação" footer={<Button onClick={() => setModal(false)}>Entendi</Button>}>
        <p>Exemplo de modal acessível: foco preso, Esc fecha e o foco volta ao botão.</p>
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Detalhes do item" footer={<Button variant="secondary" onClick={() => setDrawer(false)}>Fechar</Button>}>
        <p>Painel lateral de exemplo.</p>
      </Drawer>
      <div style={{ height: 24 }} />
      <h3>Sidebar (demonstração)</h3>
      <div style={{ maxWidth: 320, border: "1px solid var(--ln-color-border)" }}>
        <Sidebar brand="LN Studio" label="Navegação do Studio (exemplo)" footer="Ambiente de demonstração" groups={[
          { title: "Redação", items: [{ label: "Visão geral", href: "#v", current: true }, { label: "Fila editorial", href: "#f", badge: 14 }] },
          { title: "Negócios", items: [{ label: "Campanhas", href: "#c" }] },
        ]} />
      </div>
    </Container>
  );
}

const ART = { title: "Título de exemplo para validar o template visual", editoria: "Pontos & Milhas", mock: true as const };
function TemplatesDemo() {
  const checker = { background: "repeating-conic-gradient(#d9e2df 0% 25%, #fff 0% 50%) 50% / 24px 24px", padding: 12 };
  return (
    <Container as="section" aria-labelledby="s-tpl" style={{ paddingBlock: 16 }}>
      <SectionHeading id="s-tpl" title="Templates visuais" eyebrow="MOCK" description="Gerados por código a partir do brandkit; formatos sociais pertencem ao packages/growth." />
      <Grid cols={{ base: 1, md: 2 }} gap="lg">
        <div><h3>Thumbnail 1280×720</h3><TemplateImage asset={renderThumbnail({ ...ART, theme: "primary" })} /></div>
        <div><h3>Capa 1920×1080</h3><TemplateImage asset={renderCover({ ...ART, deck: "Texto de apoio simulado para a capa.", dateLabel: "22 de novembro de 2026" })} /></div>
        <div><h3>Lower third (fundo transparente)</h3><div style={checker}><TemplateImage asset={renderLowerThird({ name: "Nome do executivo", role: "Cargo · Empresa", mock: true })} /></div></div>
        <div><h3>Vinheta de abertura</h3><TemplateImage asset={renderVignette({ kind: "intro", mock: true })} /></div>
        <div><h3>Vinheta de encerramento</h3><TemplateImage asset={renderVignette({ kind: "outro", caption: "Programa de exemplo", footer: "Rodapé de exemplo", mock: true })} /></div>
      </Grid>
    </Container>
  );
}

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
          <AdSlot position="TOP" />
          <Grid cols={{ base: 1, md: 2 }}><AdSlot position="SIDEBAR_1" /><AdSlot position="ARTICLE_INLINE" /></Grid>
        </Container>
        <StudioDemo />
        <TemplatesDemo />
      </main>
      <Footer year={2026} groups={[{ title: "Exemplo", links: [{ label: "Link de exemplo", href: "#exemplo" }] }]} note="Vitrine interna — não é página pública." />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
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
