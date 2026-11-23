import { cx, formatDateShortPtBR, type LinkAs } from "../utils";
import type { EditoriaLike } from "../editorias";
import { EditoriaBadge } from "./Tag";
import { MockBadge } from "./MockBadge";

export type ArticleCardSize = "lg" | "md" | "sm" | "compact";

export interface ArticleCardProps {
  title: string;
  href: string;
  size?: ArticleCardSize;
  editoria?: EditoriaLike;
  excerpt?: string;
  /** ISO 8601. */
  publishedAt?: string;
  readingMinutes?: number;
  author?: string;
  imageSrc?: string;
  /** Obrigatório com `imageSrc`; use "" só se a imagem for puramente decorativa. */
  imageAlt?: string;
  /** Rótulo visível sobre a imagem, ex.: "Ilustração" (templates por código) ou crédito curto. */
  imageLabel?: string;
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
  imageLabel,
  headingLevel = 3,
  rank,
  isMock,
  linkAs,
  className,
}: ArticleCardProps) {
  const Link = linkAs ?? "a";
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  // Sem foto não há caixa de imagem: o cartão fica só com texto (nada de bloco vazio ocupando a página).
  const showMedia = size !== "compact" && Boolean(imageSrc);
  const showExcerpt = Boolean(excerpt) && (size === "lg" || size === "md");
  const date = publishedAt ? formatDateShortPtBR(publishedAt) : "";

  return (
    <article className={cx("ln-card", `ln-card--${size}`, !showMedia && size !== "compact" && "ln-card--noimg", className)}>
      {showMedia ? (
        <div className="ln-card__media">
          <img src={imageSrc} alt={imageAlt} loading="lazy" decoding="async" />
          {imageLabel ? <span className="ln-card__imglabel">{imageLabel}</span> : null}
        </div>
      ) : null}
      <div className="ln-card__body">
        <div className="ln-card__meta">
          {rank ? <span className="ln-card__rank"><span className="ln-sr-only">Posição </span>{rank}</span> : null}
          {editoria ? <EditoriaBadge editoria={editoria} /> : null}
          {isMock ? <MockBadge label="" /> : null}
        </div>
        <Heading className="ln-card__title">
          <Link href={href} className="ln-card__link">
            {title}
          </Link>
        </Heading>
        {showExcerpt ? <p className="ln-card__excerpt">{excerpt}</p> : null}
        {date || (author && size === "lg") || readingMinutes ? (
          <p className="ln-card__byline">
            {author && size === "lg" ? <span className="ln-card__author">{author}</span> : null}
            {date && publishedAt ? <time dateTime={publishedAt}>{date}</time> : null}
            {readingMinutes ? <span>{readingMinutes} min de leitura</span> : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}
