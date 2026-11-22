// @vitest-environment jsdom
import "./setup";
import type { AnchorHTMLAttributes } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoViolations } from "./a11y";
import { describe, expect, it } from "vitest";
import { ArticleCard, EDITORIAS, Footer, Header, Logo, MockBadge, Monogram } from "../index";


describe("Header", () => {
  it("lista as 10 editorias em <nav aria-label='Editorias'> e marca a atual", () => {
    render(<Header currentSlug="pontos" />);
    const nav = screen.getByRole("navigation", { name: "Editorias" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(10);
    expect(within(nav).getByRole("link", { name: "Pontos & Milhas" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "CRM & CX" })).not.toHaveAttribute("aria-current");
  });
  it("utilityLinks: segundo landmark nomeado, com aria-current, sem misturar com as editorias", async () => {
    const { container } = render(
      <Header
        utilityLinks={[
          { label: "Em alta", href: "/em-alta", current: true },
          { label: "Agenda", href: "/agenda" },
        ]}
      />,
    );
    const util = screen.getByRole("navigation", { name: "Atalhos do portal" });
    expect(within(util).getAllByRole("link")).toHaveLength(2);
    expect(within(util).getByRole("link", { name: "Em alta" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "Editorias" })).getAllByRole("link")).toHaveLength(10);
    await expectNoViolations(container);
  });
  it("tem link 'Pular para o conteúdo' apontando para o main", () => {
    render(<Header mainId="principal" />);
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" })).toHaveAttribute("href", "#principal");
  });
  it("botão de menu alterna aria-expanded e Escape fecha devolvendo o foco", async () => {
    const user = userEvent.setup();
    render(<Header />);
    const btn = screen.getByRole("button", { name: "Menu" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await user.click(btn);
    expect(screen.getByRole("button", { name: "Fechar menu" })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
  });
  it("usa o linkAs injetado", () => {
    const Custom = ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={href} data-custom="1" {...rest}>
        {children}
      </a>
    );
    const { container } = render(<Header linkAs={Custom} />);
    expect(container.querySelectorAll("[data-custom='1']").length).toBe(11); // logo + 10
  });
  it("sem violações axe", async () => {
    const { container } = render(
      <main id="conteudo">
        <Header currentSlug="crm" />
      </main>,
    );
    await expectNoViolations(container);
  });
});

describe("Footer", () => {
  it("lista as 10 editorias, grupos extras e © sem inventar ano", () => {
    render(<Footer groups={[{ title: "Institucional", links: [{ label: "Sobre", href: "/sobre" }] }]} />);
    expect(within(screen.getByRole("navigation", { name: "Editorias (rodapé)" })).getAllByRole("link")).toHaveLength(10);
    expect(screen.getByRole("link", { name: "Sobre" })).toHaveAttribute("href", "/sobre");
    expect(screen.getByText(/© Loyalty News/)).toBeInTheDocument();
  });
  it("renderiza o ano quando informado", () => {
    render(<Footer year={2026} />);
    expect(screen.getByText("© 2026 Loyalty News")).toBeInTheDocument();
  });
  it("sem violações axe", async () => {
    const { container } = render(<Footer year={2026} />);
    await expectNoViolations(container);
  });
});

describe("ArticleCard", () => {
  const base = { title: "Título de teste", href: "/m/teste" };
  it("expõe um único link (o título) e usa o nível de título pedido", () => {
    render(<ArticleCard {...base} editoria={EDITORIAS[2]} headingLevel={2} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Título de teste" })).toBeInTheDocument();
    expect(screen.getByText("Pontos & Milhas")).toBeInTheDocument();
  });
  it.each(["lg", "md", "sm", "compact"] as const)("tamanho %s renderiza e passa no axe", async (size) => {
    const { container } = render(
      <ArticleCard {...base} size={size} excerpt="Resumo." publishedAt="2026-11-22T12:00:00-03:00" author="Redação" />,
    );
    expect(container.querySelector(`.ln-card--${size}`)).not.toBeNull();
    await expectNoViolations(container);
  });
  it("sem imagem usa placeholder decorativo (aria-hidden), nunca imagem inventada", () => {
    const { container } = render(<ArticleCard {...base} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".ln-card__placeholder")).toHaveAttribute("aria-hidden", "true");
  });
  it("data em pt-BR com <time dateTime>", () => {
    render(<ArticleCard {...base} publishedAt="2026-11-22T12:00:00-03:00" />);
    const t = document.querySelector("time")!;
    expect(t).toHaveAttribute("datetime", "2026-11-22T12:00:00-03:00");
    expect(t.textContent).toBe("22 de novembro de 2026");
  });
  it("isMock mostra o selo MOCK visível", () => {
    render(<ArticleCard {...base} isMock />);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
  });
  it("rank aparece com rótulo acessível", () => {
    render(<ArticleCard {...base} size="compact" rank={3} />);
    expect(document.querySelector(".ln-card__rank")).toHaveTextContent("Posição 3");
  });
});

describe("Logo e MockBadge", () => {
  it.each(["primary", "reverse", "white", "monochrome"] as const)("Logo %s: 12 caminhos oficiais e nome acessível", (v) => {
    const { container } = render(<Logo variant={v} />);
    expect(container.querySelectorAll("path")).toHaveLength(12);
    expect(screen.getByRole("img", { name: "Loyalty News" })).toBeInTheDocument();
  });
  it("Logo decorativo some da árvore de acessibilidade", () => {
    const { container } = render(<Logo decorative />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
  it("Monograma renderiza", () => {
    const { container } = render(<Monogram variant="dark" />);
    expect(container.querySelectorAll("path").length).toBe(3);
  });
  it("MockBadge sempre contém a palavra MOCK", () => {
    render(<MockBadge />);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent(/MOCK/);
  });
});
