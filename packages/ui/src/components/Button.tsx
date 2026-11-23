import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx, type LinkAs } from "../utils";

type Common = {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  children: ReactNode;
  className?: string;
};
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined; linkAs?: undefined };
type AsLink = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & { href: string; linkAs?: LinkAs };
export type ButtonProps = AsButton | AsLink;

/** Botão (ou link com aparência de botão quando recebe `href`). Alvo mínimo de toque 44px. */
export function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", className, children, ...rest } = props;
  const cls = cx("ln-btn", `ln-btn--${variant}`, size === "lg" && "ln-btn--lg", className);
  if ("href" in rest && rest.href !== undefined) {
    const { linkAs, ...a } = rest as AsLink;
    const Link = linkAs ?? "a";
    return (
      <Link className={cls} {...a}>
        {children}
      </Link>
    );
  }
  const { type = "button", ...b } = rest as AsButton;
  return (
    <button className={cls} type={type} {...b}>
      {children}
    </button>
  );
}
