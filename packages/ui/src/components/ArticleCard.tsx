import { cx, formatDatePtBR, type LinkAs } from "../utils";
import type { Editoria } from "../editorias";
import { EditoriaBadge } from "./Tag";
import { MockBadge } from "./MockBadge";
import { Monogram } from "./Logo";

export type ArticleCardSize = "lg" | "md" | "sm" | "compact";

export interface ArticleCardProps {
  title: string;
  href: string;
  size?: ArticleCardSize;
  editoria?: Pick<Editoria, "slug" | "nome">;
  excerpt?: string;
  /** ISO 8601. */
  publishedAt?: string;
  readingMinutes?: number;
  author?: string;
  imageSrc?: string;
  /** Obrigatório com `imageSrc`; use "" só se a imagem for puramente decorativa. */
  imageAlt?: string;
  /** Nível do título (h2–h4) conforme a hierarquia da página. */
  headingLevel?: 2 | 3 | 4;
  /** Posição em listas "Em Alta" (exibe número). */
  rank?: number;
  /** Conteúdo simulado: exibe o selo MOCK visível. */
  isMock?: boolean;
  linkAs?: LinkAs;
  className?: string;
}

/**
 * Cartão de matéria. O título é o único link (a área toda do cartão é clicável via CSS),
 * então leitores de tela anunciam um link por matéria.
 */
export function ArticleCard({
  title,
  href,
  size = "md",
  editoria,
  excerpt,
  publishedAt,
  readingMinutes,
  author,
  imageSrc,
  imageAlt = "",
  headingLevel = 3,
  rank,
  isMock,
  linkAs,
  className,
}: ArticleCardProps) {
  const Link = linkAs ?? "a";
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const showMedia = size !== "compact";
  const showExcerpt = Boolean(excerpt) && (size === "lg" || size === "md");
  const date = publishedAt ? formatDatePtBR(publishedAt) : "";

  return (
    <article className={cx("ln-card", `ln-card--${size}`, className)}>
      {showMedia ? (
        <div className="ln-card__media">
          {imageSrc ? (
            <img src={imageSrc} alt={imageAlt} loading="lazy" decoding="async" />
          ) : (
            <div className="ln-card__placeholder" aria-hidden="true">
              <Monogram variant="light" size={size === "lg" ? 72 : 40} decorative />
            </div>
          )}
        </div>
      ) : null}
      <div className="ln-card__body">
        <div className="ln-card__meta">
          {rank ? <span className="ln-card__rank"><span className="ln-sr-only">Posição </span>{rank}</span> : null}
          {editoria ? <EditoriaBadge editoria={editoria} /> : null}
          {isMock ? <MockBadge /> : null}
        </div>
        <Heading className="ln-card__title">
          <Link href={href} className="ln-card__link">
            {title}
          </Link>
        </Heading>
        {showExcerpt ? <p className="ln-card__excerpt">{excerpt}</p> : null}
        {date || author || readingMinutes ? (
          <p className="ln-card__byline">
            {author ? <span>{author}</span> : null}
            {date && publishedAt ? <time dateTime={publishedAt}>{date}</time> : null}
            {readingMinutes ? <span>{readingMinutes} min de leitura</span> : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}
