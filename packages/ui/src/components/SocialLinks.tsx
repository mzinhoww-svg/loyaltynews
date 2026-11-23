import { cx } from "../utils";

export type SocialNetwork = "linkedin" | "instagram" | "x" | "youtube" | "whatsapp" | "googlenews" | "rss" | "email";

export interface SocialLink {
  network: SocialNetwork;
  /** URL real do perfil/canal. Sem href, o ícone NÃO é renderizado (nenhum link inventado). */
  href: string;
}

const NAMES: Record<SocialNetwork, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  googlenews: "Google Notícias",
  rss: "Feed RSS",
  email: "E-mail",
};

/** Links que não abrem página externa (mailto, feed). */
const SAME_TAB: ReadonlySet<SocialNetwork> = new Set(["email", "rss"]);

const strokeProps = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Ícones geométricos próprios (24×24, currentColor), não são os logotipos oficiais das marcas. */
function Glyph({ network }: { network: SocialNetwork }) {
  switch (network) {
    case "linkedin":
      return (
        <g fill="currentColor">
          <circle cx="6" cy="6.2" r="1.8" />
          <rect x="4.4" y="9.2" width="3.2" height="10.4" rx="0.4" />
          <path d="M10.2 9.2h3v1.5c.6-1 1.8-1.8 3.4-1.8 2.7 0 3.9 1.7 3.9 4.5v5.6h-3.2v-5c0-1.4-.5-2.3-1.8-2.3-1.4 0-2.1 1-2.1 2.4v4.9h-3.2z" />
        </g>
      );
    case "instagram":
      return (
        <g {...strokeProps}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
        </g>
      );
    case "x":
      return (
        <g {...strokeProps}>
          <path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />
        </g>
      );
    case "youtube":
      return (
        <g {...strokeProps}>
          <rect x="2.8" y="5.8" width="18.4" height="12.4" rx="4" />
          <path d="M10.2 9.6v4.8l4.2-2.4z" fill="currentColor" />
        </g>
      );
    case "whatsapp":
      return (
        <g {...strokeProps}>
          <path d="M20.5 11.5a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.7-4.5a8.4 8.4 0 1 1 15.3-4.5z" />
        </g>
      );
    case "googlenews":
      return (
        <g {...strokeProps}>
          <path d="M19.2 7.6A8 8 0 1 0 20 12h-7.6" />
        </g>
      );
    case "rss":
      return (
        <g {...strokeProps}>
          <path d="M4.5 11a8.5 8.5 0 0 1 8.5 8.5M4.5 4.5A15 15 0 0 1 19.5 19.5" />
          <circle cx="5.5" cy="18.5" r="1" fill="currentColor" />
        </g>
      );
    case "email":
      return (
        <g {...strokeProps}>
          <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2" />
          <path d="M4 7l8 6 8-6" />
        </g>
      );
  }
}

export interface SocialLinksProps {
  links: readonly SocialLink[];
  /** Nome do landmark de navegação. */
  label?: string;
  className?: string;
}

/**
 * Fileira de ícones de redes. Cada ícone é um link com nome acessível ("LinkedIn (abre em nova aba)"),
 * alvo de 44px e foco visível. Só renderiza os links recebidos: sem URL real, sem ícone.
 */
export function SocialLinks({ links, label = "Redes sociais do Loyalty News", className }: SocialLinksProps) {
  const valid = links.filter((l) => l.href.trim() !== "");
  if (valid.length === 0) return null;
  return (
    <nav aria-label={label} className={cx("ln-social", className)}>
      <ul className="ln-social__list">
        {valid.map((l) => {
          const external = !SAME_TAB.has(l.network);
          return (
            <li key={`${l.network}-${l.href}`}>
              <a
                href={l.href}
                className="ln-social__link"
                aria-label={external ? `${NAMES[l.network]} (abre em nova aba)` : NAMES[l.network]}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                  <Glyph network={l.network} />
                </svg>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
