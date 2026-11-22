import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import {
  AdSlot,
  Breadcrumb,
  Button,
  EmptyState,
  Input,
  MockFrame,
  Pagination,
  SearchInput,
  SectionHeading,
  Tag,
  EditoriaBadge,
  EDITORIAS,
  pageRange,
} from "../src";

const axeOpts = { rules: { "color-contrast": { enabled: false } } };

describe("Button", () => {
  it("renderiza <button type=button> por padrão e dispara onClick", async () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>Salvar</Button>);
    const b = screen.getByRole("button", { name: "Salvar" });
    expect(b).toHaveAttribute("type", "button");
    await userEvent.click(b);
    expect(fn).toHaveBeenCalledOnce();
  });
  it("com href vira link", () => {
    render(<Button href="/x">Ir</Button>);
    expect(screen.getByRole("link", { name: "Ir" })).toHaveAttribute("href", "/x");
  });
  it("disabled não dispara", async () => {
    const fn = vi.fn();
    render(<Button disabled onClick={fn}>X</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(fn).not.toHaveBeenCalled();
  });
  it.each(["primary", "secondary", "ghost"] as const)("variante %s sem violações axe", async (v) => {
    const { container } = render(<Button variant={v}>Ação</Button>);
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
});

describe("Input / SearchInput", () => {
  it("associa rótulo, dica e erro; marca aria-invalid", async () => {
    const { container } = render(<Input label="E-mail" hint="Use o corporativo" error="Formato inválido" required />);
    const input = screen.getByLabelText(/E-mail/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const desc = input.getAttribute("aria-describedby")!.split(" ");
    expect(desc).toHaveLength(2);
    expect(screen.getByText("Formato inválido")).toBeInTheDocument();
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
  it("SearchInput: landmark search, onSearch com termo aparado, ignora vazio", async () => {
    const onSearch = vi.fn();
    const { container } = render(<SearchInput onSearch={onSearch} />);
    const form = screen.getByRole("search");
    const input = within(form).getByLabelText("Buscar");
    await userEvent.click(within(form).getByRole("button", { name: "Buscar" }));
    expect(onSearch).not.toHaveBeenCalled();
    await userEvent.type(input, "  milhas  {Enter}");
    expect(onSearch).toHaveBeenCalledWith("milhas");
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
});

describe("Pagination", () => {
  it("pageRange com reticências", () => {
    expect(pageRange(1, 5)).toEqual([1, 2, "…", 5]);
    expect(pageRange(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
    expect(pageRange(1, 20)).toEqual([1, 2, "…", 20]);
    expect(pageRange(3, 4)).toEqual([1, 2, 3, 4]);
  });
  it("links reais, aria-current na atual, anterior desabilitado na 1ª", async () => {
    const { container } = render(<Pagination page={1} totalPages={5} hrefFor={(p) => `/p/${p}`} />);
    const nav = screen.getByRole("navigation", { name: "Paginação" });
    expect(within(nav).getByRole("link", { name: "Página 1" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Página 2" })).toHaveAttribute("href", "/p/2");
    expect(nav.querySelector("[aria-disabled='true']")).not.toBeNull();
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
  it("modo callback", async () => {
    const fn = vi.fn();
    render(<Pagination page={2} totalPages={3} onPageChange={fn} />);
    await userEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(fn).toHaveBeenCalledWith(3);
  });
  it("não renderiza com 1 página", () => {
    const { container } = render(<Pagination page={1} totalPages={1} hrefFor={() => "/"} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EmptyState", () => {
  it("status por padrão; alert para erro; sem dados inventados", async () => {
    const { container, rerender } = render(<EmptyState title="Nenhuma matéria publicada ainda" description="Volte em breve." />);
    expect(screen.getByRole("status")).toHaveTextContent("Nenhuma matéria publicada ainda");
    rerender(<EmptyState kind="error" title="Falha ao carregar" action={<Button href="/">Voltar</Button>} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
});

describe("AdSlot", () => {
  it.each(["leaderboard", "billboard", "mrec", "mobile-banner"] as const)("%s: rotulado 'Publicidade' e marcado como placeholder", async (f) => {
    const { container } = render(<AdSlot format={f} />);
    const aside = screen.getByRole("group", { name: "Publicidade" });
    expect(within(aside).getByText("Publicidade")).toBeVisible();
    expect(container.querySelector("[data-placeholder='true']")).not.toBeNull();
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
  it("com filhos deixa de ser placeholder e mantém o rótulo", () => {
    const { container } = render(<AdSlot>conteúdo do anunciante</AdSlot>);
    expect(container.querySelector("[data-placeholder]")).toBeNull();
    expect(screen.getByText("Publicidade")).toBeInTheDocument();
  });
});

describe("Breadcrumb / SectionHeading / Tag / Mock", () => {
  it("Breadcrumb: último item é a página atual, sem link", async () => {
    const { container } = render(<Breadcrumb items={[{ label: "Início", href: "/" }, { label: "Pontos & Milhas", href: "/e/p" }, { label: "Matéria" }]} />);
    const nav = screen.getByRole("navigation", { name: "Você está aqui" });
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    expect(within(nav).getByText("Matéria")).toHaveAttribute("aria-current", "page");
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
  it("SectionHeading respeita o nível e mostra ação", async () => {
    const { container } = render(<SectionHeading title="Em Alta" eyebrow="Destaques" level={2} action={{ label: "Ver todas", href: "/alta" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Em Alta" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/alta");
    expect(await axe(container, axeOpts)).toHaveNoViolations();
  });
  it("Tag e EditoriaBadge como link/texto", () => {
    render(
      <>
        <Tag href="/t/x">x</Tag>
        <Tag>y</Tag>
        <EditoriaBadge editoria={EDITORIAS[0]!} asLink />
      </>,
    );
    expect(screen.getByRole("link", { name: "x" })).toHaveAttribute("href", "/t/x");
    expect(screen.getByRole("link", { name: "Mercado & Negócios" })).toHaveAttribute("href", "/editorias/mercado-e-negocios");
  });
  it("MockFrame sempre exibe MOCK", () => {
    render(<MockFrame>conteúdo</MockFrame>);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
  });
});
