// @vitest-environment jsdom
import "./setup";
import type { AnchorHTMLAttributes } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoViolations } from "./a11y";
import { describe, expect, it } from "vitest";
import { ArticleCard, DEMO_BANNER_TEXT, DemoBanner, EDITORIAS, FOOTER_TAGLINE, Footer, Header, Logo, MockBadge, Monogram, SearchIconLink, SocialLinks } from "../index";


const LINKS = [
  { label: "Agenda", href: "/agenda" },
  { label: "Intelligence", href: "/intelligence", current: true },
];
const MENU = { label: "Editorias", position: 1 };

describe("Header (barra enxuta + menu de editorias)", () => {
  it("a barra tem poucas entradas fixas e NÃO lista as 10 editorias fora do menu", () => {
    render(<Header links={LINKS} menu={MENU} />);
    const bar = within(screen.getByRole("navigation", { name: "Seções do portal" }));
    // 2 links fixos + botão do menu: as editorias só existem dentro do menu (fechado = escondido)
    expect(bar.getAllByRole("link")).toHaveLength(2);
    expect(bar.getByRole("button", { name: /Editorias/ })).toHaveAttribute("aria-expanded", "false");
    expect(bar.getByRole("link", { name: "Intelligence" })).toHaveAttribute("aria-current", "page");
  });
  it("respeita a posição do menu entre os links", () => {
    render(<Header links={LINKS} menu={MENU} />);
    const items = [...screen.getByRole("navigation", { name: "Seções do portal" }).querySelectorAll(".ln-header__main-list > li")].map((li) => li.textContent?.trim());
    expect(items[0]).toBe("Agenda");
    expect(items[1]).toMatch(/^Editorias/);
    expect(items[2]).toBe("Intelligence");
  });
  it("mega-menu abre com as 10 editorias, marca a atual, fecha com Esc devolvendo o foco", async () => {
    const user = userEvent.setup();
    render(<Header links={LINKS} menu={{ ...MENU, allLink: { label: "Ver todas", href: "/noticias" } }} currentSlug="pontos" />);
    const btn = screen.getByRole("button", { name: /Editorias/ });
    const mega = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(mega).toHaveAttribute("hidden");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(mega).not.toHaveAttribute("hidden");
    expect(within(mega).getAllByRole("link").filter((l) => !/Ver todas/.test(l.textContent ?? ""))).toHaveLength(10);
    expect(within(mega).getByRole("link", { name: "Pontos & Milhas" })).toHaveAttribute("aria-current", "page");
    expect(btn).toHaveAttribute("data-current", "true");
    expect(within(mega).getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/noticias");
    await user.keyboard("{Escape}");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveFocus();
  });
  it("menu com coluna de conteúdo (opção Notícias ▾)", async () => {
    const user = userEvent.setup();
    render(<Header menu={{ label: "Notícias", contentLinks: [{ label: "Todas as notícias", href: "/noticias" }, { label: "Loyalty Flash", href: "/flash" }] }} />);
    await user.click(screen.getByRole("button", { name: /Notícias/ }));
    const mega = document.querySelector(".ln-header__mega")!;
    expect(within(mega as HTMLElement).getByText("Conteúdo")).toBeInTheDocument();
    expect(within(mega as HTMLElement).getByRole("link", { name: "Loyalty Flash" })).toHaveAttribute("href", "/flash");
    expect(mega.querySelector(".ln-header__mega-grid--single")).toBeNull();
  });
  it("clique fora fecha o mega-menu", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>fora</button>
        <Header menu={MENU} />
      </>,
    );
    const btn = screen.getByRole("button", { name: /Editorias/ });
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "fora" }));
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
  it("painel móvel: Menu abre com links, editorias e CTA; Esc fecha devolvendo o foco", async () => {
    const user = userEvent.setup();
    render(<Header links={LINKS} menu={MENU} cta={{ label: "Anuncie", href: "/midia-kit" }} />);
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Fechar" })).toHaveAttribute("aria-expanded", "true");
    const panel = within(screen.getByRole("navigation", { name: "Menu e editorias" }));
    expect(panel.getByRole("link", { name: "Agenda" })).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Bancos & Cartões" })).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Anuncie" })).toHaveAttribute("href", "/midia-kit");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
  });
  it("CTA aparece na barra e actions ficam sempre visíveis", () => {
    render(<Header cta={{ label: "Anuncie", href: "/midia-kit" }} actions={<span>ações</span>} />);
    expect(screen.getAllByRole("link", { name: "Anuncie" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("ações")).toBeInTheDocument();
  });
  it("tem link 'Pular para o conteúdo' apontando para o main", () => {
    render(<Header mainId="principal" />);
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" })).toHaveAttribute("href", "#principal");
  });
  it("usa o linkAs injetado", () => {
    const Custom = ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={href} data-custom="1" {...rest}>
        {children}
      </a>
    );
    const { container } = render(<Header linkAs={Custom} links={LINKS} menu={MENU} cta={{ label: "Anuncie", href: "/m" }} />);
    // logo + 2 links + 10 editorias no mega + CTA + 2 links e 10 editorias no painel móvel + CTA do painel
    expect(container.querySelectorAll("[data-custom='1']").length).toBe(1 + 2 + 10 + 1 + 2 + 10 + 1);
  });
  it("sem violações axe (barra, mega-menu aberto e painel)", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <main id="conteudo">
        <Header links={[{ label: "Agenda", href: "/agenda" }, { label: "Intelligence", href: "/intelligence", current: true }]} menu={MENU} currentSlug="crm" cta={{ label: "Anuncie", href: "/m" }} actions={<SearchIconLink />} />
      </main>,
    );
    await user.click(screen.getByRole("button", { name: /Editorias/ }));
    await expectNoViolations(container);
  });
});

describe("DemoBanner", () => {
  it("mostra o texto exato exigido pelo Security, com role note", () => {
    render(<DemoBanner />);
    expect(DEMO_BANNER_TEXT).toBe("Conteúdo de demonstração — não publicado");
    expect(screen.getByRole("region", { name: /conteúdo de demonstração/i })).toHaveTextContent("Conteúdo de demonstração — não publicado");
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
  it("MockBadge compacto (label vazio): visível só 'MOCK', leitor de tela lê o texto completo", () => {
    render(<MockBadge label="" />);
    const badge = screen.getByTestId("mock-badge");
    expect(badge).toHaveTextContent("MOCK · dados de exemplo");
    expect(badge.querySelector("strong")).toHaveTextContent("MOCK");
    expect(badge.querySelector(".ln-sr-only")).toHaveTextContent("· dados de exemplo");
    expect(badge.querySelector(":scope > span:not(.ln-sr-only)")).toBeNull(); // nada extra visível
  });
  it("MockBadge com rótulo próprio mostra o rótulo visível e não duplica o texto oculto", () => {
    render(<MockBadge label="exemplo de bloco" />);
    const badge = screen.getByTestId("mock-badge");
    expect(badge).toHaveTextContent("MOCK · exemplo de bloco");
    expect(badge.querySelector(".ln-sr-only")).toBeNull();
  });
  it("MockBadge sempre contém a palavra MOCK", () => {
    render(<MockBadge />);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent(/MOCK/);
  });
});
