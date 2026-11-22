import { logoData, monogramData } from "./logo-data";

export type LogoVariant = "primary" | "reverse" | "white" | "monochrome";
export type MonogramVariant = "dark" | "light";

interface LogoProps {
  variant?: LogoVariant;
  /** Altura em px; a largura segue a proporção oficial (606×132). */
  height?: number;
  className?: string;
  /** Texto acessível. Use `decorative` quando o logo já estiver dentro de um link rotulado. */
  title?: string;
  decorative?: boolean;
}

/** Logo oficial do brandkit (SVG em curvas, inline). */
export function Logo({ variant = "primary", height = 40, className, title = "Loyalty News", decorative }: LogoProps) {
  const [w, h] = logoData.size;
  const fills = logoData.fills[variant];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width={Math.round((height * w) / h)}
      height={height}
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
    >
      {logoData.paths.map((p, i) => (
        <path key={i} d={p.d} transform={p.transform} fill={fills[i]} />
      ))}
    </svg>
  );
}

interface MonogramProps {
  variant?: MonogramVariant;
  size?: number;
  className?: string;
  title?: string;
  decorative?: boolean;
}

type Attrs = Record<string, string | undefined>;

/** Monograma oficial ".ln". */
export function Monogram({ variant = "dark", size = 40, className, title = "Loyalty News", decorative }: MonogramProps) {
  const [w, h] = monogramData.size;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={size}
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
    >
      {(monogramData[variant] as readonly Attrs[]).map((el, i) =>
        el.tag === "rect" ? (
          <rect key={i} width={el.width} height={el.height} x={el.x} y={el.y} rx={el.rx} fill={el.fill} />
        ) : (
          <path key={i} d={el.d} transform={el.transform} fill={el.fill} />
        ),
      )}
    </svg>
  );
}
