/* GERADO por scripts/build-tokens.mjs — não editar.
 * Fonte: tokens/design.tokens.json (brandkit 2.0-draft.1, status "proposal_not_approved")
 * + tokens/extensions.json (derivados da frente 05; ver _nota). */

export const meta = {
  "brandVersion": "2.0-draft.1",
  "status": "proposal_not_approved"
} as const;

export const brandColors = {
  "primary": "#153C3C",
  "secondary": "#34877A",
  "mint": "#DDEFE8",
  "black": "#101C1C",
  "white": "#FFFFFF",
  "signal": "#A7DDC9"
} as const;

export const colors = {
  "primary": "#153C3C",
  "secondary": "#34877A",
  "mint": "#DDEFE8",
  "black": "#101C1C",
  "white": "#FFFFFF",
  "signal": "#A7DDC9",
  "secondary-strong": "#2A6F65",
  "border": "#B9D3CA",
  "border-strong": "#5F7D78",
  "text-muted": "#4A5F5F",
  "warning-bg": "#FFF4CC",
  "warning-fg": "#5C4400",
  "danger": "#A12A2A",
  "focus": "#0B5FD3",
  "surface-subtle": "#F4F8F6",
  "success-bg": "#E1F3E7",
  "success-fg": "#14532D",
  "info-bg": "#E0ECFB",
  "info-fg": "#12407F",
  "danger-bg": "#FBE3E3",
  "danger-fg": "#7A1D1D",
  "neutral-bg": "#EEF1F1",
  "neutral-fg": "#2F4141"
} as const;

export const typography = {
  "ui": "Inter, Arial, sans-serif",
  "editorial": "Georgia, Noto Serif, serif",
  "logo": "outlined Noto Serif Bold"
} as const;

export const fontSize = {
  "xs": [
    "0.75rem",
    "1rem"
  ],
  "sm": [
    "0.875rem",
    "1.25rem"
  ],
  "md": [
    "1rem",
    "1.5rem"
  ],
  "lg": [
    "1.125rem",
    "1.75rem"
  ],
  "xl": [
    "1.375rem",
    "1.75rem"
  ],
  "2xl": [
    "1.75rem",
    "2.125rem"
  ],
  "3xl": [
    "2.25rem",
    "2.625rem"
  ],
  "4xl": [
    "3rem",
    "3.25rem"
  ]
} as const;

export const fontWeight = {
  "regular": "400",
  "medium": "500",
  "bold": "700"
} as const;

export const spacing = {
  "0": "0",
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "5": "24px",
  "6": "32px",
  "7": "48px",
  "8": "64px",
  "9": "96px"
} as const;

export const radius = {
  "none": "0",
  "sm": "4px",
  "md": "8px",
  "lg": "12px",
  "xl": "16px",
  "pill": "999px"
} as const;

export const breakpoints = {
  "sm": "640px",
  "md": "768px",
  "lg": "1024px",
  "xl": "1280px"
} as const;

export const layout = {
  "container": "1200px",
  "gutter": "16px",
  "gutter-lg": "24px",
  "reading": "68ch"
} as const;

export const motion = {
  "intro_s": 3.2,
  "lower_third_in_s": 0.4,
  "lower_third_out_s": 0.4,
  "outro_s": 3.5,
  "easing": "cubic-bezier(.22,.7,.2,1)"
} as const;

export const social = {
  "vertical": [
    1080,
    1350
  ],
  "square": [
    1080,
    1080
  ],
  "story": [
    1080,
    1920
  ],
  "open_graph": [
    1200,
    627
  ],
  "safe_area": 72,
  "headline_max_lines": 4
} as const;

/** Nome da CSS variable de um token: cssVar("color-primary") => "var(--ln-color-primary)". */
export const cssVar = (name: string): string => `var(--ln-${name})`;
