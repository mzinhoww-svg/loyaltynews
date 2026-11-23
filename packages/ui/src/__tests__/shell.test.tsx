// @vitest-environment jsdom
import "./setup";
import type { AnchorHTMLAttributes } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoViolations } from "./a11y";
import { describe, expect, it } from "vitest";
import { ArticleCard, DEMO_BANNER_TEXT, DemoBanner, EDITORIAS, FOOTER_TAGLINE, Footer, Header, Logo, MockBadge, Monogram, SocialLinks } from "../index";


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
    // No mobile os atalhos também entram no menu de editorias (10 editorias + 2 atalhos)
    const ed = within(screen.getByRole("navigation", { name: "Editorias" }));
    expect(ed.getAllByRole("link")).toHaveLength(12);
    expect(ed.getByRole("link", { name: "Bancos & Cartões" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Fechar" })).toHaveAttribute("aria-expanded", "true");
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
    // logo + 10 editorias + 5 repetidas no painel "Mais" (fechado, escondido; só um dos dois aparece por largura)
    expect(container.querySelectorAll("[data-custom='1']").length).toBe(16);
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

describe("Header: menu de uma linha com Mais", () => {
  it("botão Mais divulga as editorias que não cabem; Esc fecha e devolve o foco", async () => {
    const user = userEvent.setup();
    render(<Header />);
    const more = screen.getByRole("button", { name: /Mais/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(panel).toHaveAttribute("hidden");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
    // do 6º item em diante (índices 5..9 = 5 editorias)
    expect(within(panel).getAllByRole("link")).toHaveLength(5);
    expect(within(panel).getByRole("link", { name: "Regulação & Dados" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
  });
  it("clique fora fecha o painel", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>fora</button>
        <Header />
      </>,
    );
    const more = screen.getByRole("button", { name: /Mais/ });
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "fora" }));
    expect(more).toHaveAttribute("aria-expanded", "false");
  });
  it("editoria atual dentro de Mais marca o botão", () => {
    render(<Header currentSlug="regulacao" />);
    expect(screen.getByRole("button", { name: /Mais/ })).toHaveAttribute("data-current", "true");
  });
  it("com 5 editorias ou menos não há botão Mais", () => {
    render(<Header editorias={EDITORIAS.slice(0, 5)} />);
    expect(screen.queryByRole("button", { name: /Mais/ })).toBeNull();
  });
  it("itens além do 5º recebem classes de prioridade por largura", () => {
    const { container } = render(<Header visibleEditorias={6} />);
    const items = [...container.querySelectorAll(".ln-header__list > li")].slice(0, 10);
    expect(items[4]!.className).toBe("");
    expect(items[5]!.className).toContain("ln-header__item--wide");
    expect(items[6]!.className).toContain("ln-header__item--more");
  });
});

describe("DemoBanner", () => {
  it("mostra o texto exato exigido pelo Security, com role note", () => {
    render(<DemoBanner />);
    expect(DEMO_BANNER_TEXT).toBe("Conteúdo de demonstração — não publicado");
    expect(screen.getByRole("note")).toHaveTextContent("Conteúdo de demonstração — não publicado");
  });
});

describe("Footer", () => {
  it("lista as 10 editorias, grupos extras e © sem inventar ano", () => {
    render(<Footer groups={[{ title: "Institucional", links: [{ label: "Sobre", href: "/sobre" }] }]} />);
    expect(within(screen.getByRole("navigation", { name: "Editorias (rodapé)" })).getAllByRole("link")).toHaveLength(10);
    expect(screen.getByRole("link", { name: "Sobre" })).toHaveAttribute("href", "/sobre");
    expect(screen.getByText(/© Loyalty News/)).toBeInTheDocument();
  });
  it("mostra a frase institucional sob o logo por padrão e permite ocultar", () => {
    const { rerender } = render(<Footer />);
    expect(screen.getByText(FOOTER_TAGLINE)).toBeInTheDocument();
    expect(FOOTER_TAGLINE).toBe("The global network for board-level loyalty leaders.");
    rerender(<Footer tagline={null} />);
    expect(screen.queryByText(FOOTER_TAGLINE)).toBeNull();
    rerender(<Footer tagline="Outra frase" />);
    expect(screen.getByText("Outra frase")).toBeInTheDocument();
  });
  it("redes sociais: só aparecem as que têm URL; nomes acessíveis; externas abrem com rel seguro", async () => {
    const { container } = render(
      <Footer
        social={[
          { network: "linkedin", href: "https://exemplo.invalid/ln" },
          { network: "instagram", href: "" },
          { network: "email", href: "mailto:alguem@exemplo.invalid" },
          { network: "rss", href: "/feed.xml" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Redes sociais do Loyalty News" });
    expect(within(nav).getAllByRole("link")).toHaveLength(3);
    expect(within(nav).queryByRole("link", { name: /Instagram/ })).toBeNull(); // sem URL, sem ícone
    const ln = within(nav).getByRole("link", { name: "LinkedIn (abre em nova aba)" });
    expect(ln).toHaveAttribute("target", "_blank");
    expect(ln).toHaveAttribute("rel", "noopener noreferrer");
    const mail = within(nav).getByRole("link", { name: "E-mail" });
    expect(mail).not.toHaveAttribute("target");
    expect(within(nav).getByRole("link", { name: "Feed RSS" })).toHaveAttribute("href", "/feed.xml");
    await expectNoViolations(container);
  });
  it("sem redes configuradas não renderiza o landmark de redes", () => {
    render(<Footer />);
    expect(screen.queryByRole("navigation", { name: "Redes sociais do Loyalty News" })).toBeNull();
  });
  it("todos os ícones disponíveis renderizam um SVG decorativo", () => {
    const all = ["linkedin", "instagram", "x", "youtube", "whatsapp", "googlenews", "rss", "email"] as const;
    const { container } = render(<SocialLinks links={all.map((n) => ({ network: n, href: `https://exemplo.invalid/${n}` }))} />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(8);
    svgs.forEach((svg) => {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg.querySelector("path,rect,circle")).not.toBeNull();
    });
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
  it("sem foto não há caixa de imagem nem imagem inventada; o cartão vira só texto", () => {
    const { container } = render(<ArticleCard {...base} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".ln-card__media")).toBeNull();
    expect(container.querySelector(".ln-card")).toHaveClass("ln-card--noimg");
  });
  it("com foto mostra a imagem e o rótulo visível (ex.: Ilustração)", () => {
    const { container } = render(<ArticleCard {...base} imageSrc="data:image/svg+xml;base64,PHN2Zy8+" imageAlt="" imageLabel="Ilustração" />);
    expect(container.querySelector("img")).not.toBeNull();
    expect(screen.getByText("Ilustração")).toBeVisible();
    expect(container.querySelector(".ln-card")).not.toHaveClass("ln-card--noimg");
  });
  it("data em pt-BR com <time dateTime>", () => {
    render(<ArticleCard {...base} publishedAt="2026-11-22T12:00:00-03:00" />);
    const t = document.querySelector("time")!;
    expect(t).toHaveAttribute("datetime", "2026-11-22T12:00:00-03:00");
    expect(t.textContent).toBe("22 nov 2026");
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
