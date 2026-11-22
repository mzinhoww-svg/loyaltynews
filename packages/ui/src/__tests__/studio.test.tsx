// @vitest-environment jsdom
import "./setup";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoViolations } from "./a11y";
import {
  DataTable,
  type DataTableColumn,
  Drawer,
  Form,
  FormField,
  KpiCard,
  Modal,
  Sidebar,
  StatusPill,
  StudioLayout,
  Tabs,
  ToastProvider,
  rules,
  useToast,
} from "../index";

describe("StatusPill", () => {
  it.each(["neutral", "info", "success", "warning", "danger"] as const)("%s mostra texto + glifo (não só cor) e passa no axe", async (tone) => {
    const { container } = render(<StatusPill label="Em revisão" tone={tone} />);
    expect(screen.getByText("Em revisão")).toBeVisible();
    expect(container.querySelector(".ln-pill__glyph")).toHaveAttribute("aria-hidden", "true");
    await expectNoViolations(container);
  });
});

describe("KpiCard", () => {
  it("mostra valor, origem e período", async () => {
    const { container } = render(<KpiCard label="Matérias publicadas" value={12} source="CMS (tabela articles)" period="últimos 7 dias" />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("CMS (tabela articles)")).toBeInTheDocument();
    expect(screen.getByText("últimos 7 dias")).toBeInTheDocument();
    await expectNoViolations(container);
  });
  it("sem valor = estado vazio honesto (nunca zero inventado)", () => {
    render(<KpiCard label="Audiência" value={null} source="GA4" period="30 dias" />);
    expect(screen.getByText("Sem dados")).toBeInTheDocument();
    expect(screen.getByText("Sem dados no período.")).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });
  it.each([
    ["origem", { source: "", period: "7 dias" }],
    ["período", { source: "GA4", period: "  " }],
  ])("sem %s o número NÃO é exibido e aparece alerta", (_n, p) => {
    render(<KpiCard label="Sessões" value={999} {...p} />);
    expect(screen.queryByText("999")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/Indicador inválido/);
  });
  it("isMock mostra MOCK; variação tem texto acessível", () => {
    render(<KpiCard label="Itens" value="8" source="fixture" period="demo" isMock delta={{ text: "+4%", direction: "up" }} />);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
    expect(screen.getByText("Alta de")).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  const tabs = [
    { id: "a", label: "Todos", content: <p>conteúdo A</p> },
    { id: "b", label: "Revisão", content: <p>conteúdo B</p> },
    { id: "c", label: "Bloqueados", content: <p>conteúdo C</p>, disabled: true },
    { id: "d", label: "Agendados", content: <p>conteúdo D</p> },
  ];
  it("ARIA: tablist/tab/tabpanel, tabindex móvel e setas/Home/End", async () => {
    const user = userEvent.setup();
    const { container } = render(<Tabs label="Filtro" tabs={tabs} />);
    const list = screen.getByRole("tablist", { name: "Filtro" });
    expect(within(list).getAllByRole("tab")).toHaveLength(4);
    const tabA = screen.getByRole("tab", { name: "Todos" });
    expect(tabA).toHaveAttribute("aria-selected", "true");
    expect(tabA).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Revisão" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("conteúdo A");
    tabA.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Revisão" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("conteúdo B");
    await user.keyboard("{ArrowRight}"); // pula o desabilitado
    expect(screen.getByRole("tab", { name: "Agendados" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Todos" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Agendados" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Todos" })).toHaveAttribute("aria-selected", "true");
    await expectNoViolations(container);
  });
});

describe("Modal / Drawer", () => {
  function Demo({ placement }: { placement?: "right" }) {
    const [open, setOpen] = useState(false);
    const M = placement === "right" ? Drawer : Modal;
    return (
      <>
        <button onClick={() => setOpen(true)}>Abrir</button>
        <M open={open} onClose={() => setOpen(false)} title="Editar fonte" footer={<button onClick={() => setOpen(false)}>Cancelar</button>}>
          <label>
            Nome <input />
          </label>
        </M>
      </>
    );
  }
  it("abre com role=dialog nomeado, prende o Tab, Esc fecha e devolve o foco", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Editar fonte" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.body.style.overflow).toBe("hidden");
    // primeiro foco: primeiro elemento focável do diálogo
    expect(screen.getByRole("button", { name: "Fechar" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.tab(); // volta ao início, não escapa do diálogo
    expect(screen.getByRole("button", { name: "Fechar" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(opener).toHaveFocus();
  });
  it("clique no fundo fecha; clique dentro não", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.pointer({ keys: "[MouseLeft]", target: screen.getByTestId("modal-backdrop") });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("não cria landmarks banner/contentinfo dentro do diálogo (achado do axe real)", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });
  it("Drawer usa o lado direito e passa no axe", async () => {
    const user = userEvent.setup();
    render(<Demo placement="right" />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("dialog")).toHaveClass("ln-modal--drawer");
    await expectNoViolations(document.body);
  });
});

describe("Toast", () => {
  afterEach(() => vi.useRealTimers());
  function Trigger({ tone, duration }: { tone?: "info" | "danger"; duration?: number }) {
    const { push } = useToast();
    return <button onClick={() => push({ title: "Salvo", description: "Matéria atualizada", tone, duration })}>Disparar</button>;
  }
  it("região de notificações e toast sem violações axe (timers reais)", async () => {
    const { container } = render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    expect(screen.getByRole("region", { name: "Notificações" })).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Disparar" }).click());
    expect(screen.getByRole("status")).toHaveTextContent("Salvo");
    await expectNoViolations(container);
  });
  it("info some sozinho após o prazo", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => screen.getByRole("button", { name: "Disparar" }).click());
    expect(screen.getByRole("status")).toHaveTextContent("Salvo");
    act(() => void vi.advanceTimersByTime(6100));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("erro usa role=alert e NÃO fecha sozinho; fecha pelo botão", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger tone="danger" />
      </ToastProvider>,
    );
    act(() => screen.getByRole("button", { name: "Disparar" }).click());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(60000));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: /Fechar notificação/ }).click());
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("useToast fora do provider falha com mensagem clara", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

describe("Sidebar / StudioLayout", () => {
  const groups = [
    { title: "Redação", items: [{ label: "Visão geral", href: "/studio", current: true }, { label: "Fila editorial", href: "/studio/fila", badge: 3 }] },
    { title: "Negócios", items: [{ label: "Campanhas", href: "/studio/campanhas" }] },
  ];
  it("nav nomeada, aria-current, badge, toggle mobile e Esc", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StudioLayout sidebar={<Sidebar groups={groups} brand="LN Studio" footer="Ambiente de demonstração" />}>
        <h1>Painel</h1>
      </StudioLayout>,
    );
    const nav = screen.getByRole("navigation", { name: "Navegação do Studio" });
    expect(within(nav).getByRole("link", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Fila editorial/ })).toHaveTextContent("3");
    expect(within(nav).getAllByRole("list")).toHaveLength(2);
    const toggle = screen.getByRole("button", { name: "Navegação" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Fechar navegação" })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Navegação" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" })).toHaveAttribute("href", "#conteudo");
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
    await expectNoViolations(container);
  });
});

interface Row {
  id: string;
  titulo: string;
  editoria: string;
  estado: string;
  palavras: number | null;
}
const ROWS: Row[] = [
  { id: "1", titulo: "Pauta C", editoria: "Bancos & Cartões", estado: "Revisão", palavras: 900 },
  { id: "2", titulo: "Pauta A", editoria: "Pontos & Milhas", estado: "Novo", palavras: 300 },
  { id: "3", titulo: "Pauta B", editoria: "Bancos & Cartões", estado: "Novo", palavras: null },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, titulo: `Extra ${String(i).padStart(2, "0")}`, editoria: "CRM & CX", estado: "Agendado", palavras: 100 + i })),
];
const COLS: DataTableColumn<Row>[] = [
  { id: "titulo", header: "Título", value: (r) => r.titulo, sortable: true },
  { id: "editoria", header: "Editoria", value: (r) => r.editoria, filterable: true },
  { id: "estado", header: "Estado", value: (r) => r.estado, filterable: true, cell: (r) => <StatusPill label={r.estado} /> },
  { id: "palavras", header: "Palavras", value: (r) => r.palavras, sortable: true, align: "end" },
];
const titles = () => within(screen.getByRole("table")).getAllByRole("rowheader").map((c) => c.textContent);

describe("DataTable", () => {
  it("região focável nomeada pela legenda; tabela com cabeçalhos e axe limpo", async () => {
    const { container } = render(<DataTable caption="Fila editorial" columns={COLS} rows={ROWS} rowKey={(r) => r.id} pageSize={5} isMock />);
    expect(screen.getByRole("region", { name: "Fila editorial" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table", { name: "Fila editorial" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
    await expectNoViolations(container);
  });
  it("ordena asc → desc → sem ordem, com aria-sort; vazios ficam por último", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="t" columns={COLS} rows={ROWS} rowKey={(r) => r.id} pageSize={50} />);
    const th = screen.getByRole("columnheader", { name: /Palavras/ });
    expect(th).toHaveAttribute("aria-sort", "none");
    await user.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(titles()[0]).toBe("Extra 00");
    expect(titles().at(-1)).toBe("Pauta B"); // palavras = null por último
    await user.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(titles()[0]).toBe("Pauta C");
    expect(titles().at(-1)).toBe("Pauta B"); // null continua por último
    await user.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "none");
  });
  it("busca e filtro por coluna reduzem as linhas e anunciam a contagem", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="t" columns={COLS} rows={ROWS} rowKey={(r) => r.id} pageSize={50} />);
    expect(screen.getByText(/Mostrando 1–12 de 12/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Buscar na tabela"), "pauta");
    expect(titles()).toHaveLength(3);
    expect(screen.getByText("Mostrando 1–3 de 3 (filtrado)")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Editoria"), "Bancos & Cartões");
    expect([...titles()].sort()).toEqual(["Pauta B", "Pauta C"]);
    await user.selectOptions(screen.getByLabelText("Estado"), "Novo");
    expect(titles()).toEqual(["Pauta B"]);
  });
  it("filtro sem resultado mostra mensagem própria (≠ tabela vazia)", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="t" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />);
    await user.type(screen.getByLabelText("Buscar na tabela"), "zzzz");
    expect(screen.getByText("Nenhum resultado para os filtros")).toBeInTheDocument();
    expect(screen.getByText("Nenhum resultado (filtrado)")).toBeInTheDocument();
  });
  it("pagina e volta à página 1 ao filtrar", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="t" columns={COLS} rows={ROWS} rowKey={(r) => r.id} pageSize={5} />);
    expect(titles()).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(screen.getByText(/Mostrando 6–10 de 12/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Buscar na tabela"), "extra");
    expect(screen.getByText(/Mostrando 1–5 de 9/)).toBeInTheDocument();
  });
  it("a paginação leva o nome da tabela (landmarks únicos com várias tabelas)", () => {
    render(
      <>
        <DataTable caption="Tabela A" columns={COLS} rows={ROWS} rowKey={(r) => r.id} pageSize={5} />
        <DataTable caption="Tabela B" columns={COLS} rows={ROWS} rowKey={(r) => r.id} pageSize={5} />
      </>,
    );
    expect(screen.getByRole("navigation", { name: "Paginação: Tabela A" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Paginação: Tabela B" })).toBeInTheDocument();
  });
  it("sem dados: EmptyState honesto, sem tabela", () => {
    render(<DataTable caption="t" columns={COLS} rows={[]} rowKey={(r) => r.id} emptyTitle="Nenhuma matéria na fila" emptyDescription="Conecte a fonte editorial." />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Nenhuma matéria na fila")).toBeInTheDocument();
  });
});

describe("Form / FormField", () => {
  function Demo({ onSubmit = vi.fn(), submitError }: { onSubmit?: (v: Record<string, string>) => void; submitError?: string }) {
    return (
      <Form initialValues={{ nome: "", email: "", tipo: "web" }} onSubmit={onSubmit} submitLabel="Salvar fonte" submitError={submitError}>
        <FormField name="nome" label="Nome da fonte" required rules={[rules.minLength(3)]} hint="Como aparece na lista" />
        <FormField name="email" label="E-mail" type="email" rules={[rules.email()]} />
        <FormField name="tipo" label="Tipo" as="select" options={[{ value: "web", label: "Site" }, { value: "rss", label: "RSS" }]} />
      </Form>
    );
  }
  it("envio inválido: resumo (alert) recebe foco, links levam ao campo, campos ficam aria-invalid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(<Demo onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Salvar fonte" }));
    const summary = screen.getByRole("alert");
    expect(summary).toHaveFocus();
    expect(within(summary).getByRole("link", { name: /Nome da fonte: Campo obrigatório/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome da fonte/)).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(within(summary).getByRole("link"));
    expect(screen.getByLabelText(/Nome da fonte/)).toHaveFocus();
    await expectNoViolations(container);
  });
  it("valida ao sair do campo; corrige ao digitar; envia valores quando válido", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Demo onSubmit={onSubmit} />);
    const nome = screen.getByLabelText(/Nome da fonte/);
    await user.type(nome, "ab");
    await user.tab();
    expect(screen.getByText("Use ao menos 3 caracteres.")).toBeInTheDocument();
    expect(nome).toHaveAttribute("aria-describedby");
    await user.type(nome, "c");
    expect(screen.queryByText("Use ao menos 3 caracteres.")).toBeNull();
    await user.type(screen.getByLabelText("E-mail"), "invalido");
    await user.tab();
    expect(screen.getByText("Informe um e-mail válido.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("E-mail"));
    await user.type(screen.getByLabelText("E-mail"), "a@b.co");
    await user.selectOptions(screen.getByLabelText("Tipo"), "rss");
    await user.click(screen.getByRole("button", { name: "Salvar fonte" }));
    expect(onSubmit).toHaveBeenCalledWith({ nome: "abc", email: "a@b.co", tipo: "rss" });
  });
  it("submitError aparece no resumo", () => {
    render(<Demo submitError="API indisponível" />);
    expect(screen.getByRole("alert")).toHaveTextContent("API indisponível");
  });
  it("FormField fora de Form falha com mensagem clara", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<FormField name="x" label="x" />)).toThrow(/dentro de <Form>/);
    spy.mockRestore();
  });
  it("regras de validação", () => {
    expect(rules.required()("  ")).toBeTruthy();
    expect(rules.required()("a")).toBeUndefined();
    expect(rules.url()("ftp://x")).toBeTruthy();
    expect(rules.url()("https://x.com/a")).toBeUndefined();
    expect(rules.pattern(/^\d+$/, "num")("12a")).toBe("num");
    expect(rules.maxLength(3)("abcd")).toBeTruthy();
  });
});
