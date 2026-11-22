import { cx } from "../utils";
import { svgToDataUri, type TemplateAsset } from "./core";

export interface TemplateImageProps {
  asset: TemplateAsset;
  /** Largura CSS (altura segue a proporção). Padrão: 100% do contêiner. */
  width?: number | string;
  className?: string;
  /** Imagem puramente decorativa (alt vazio). */
  decorative?: boolean;
}

/** Exibe um criativo gerado por código como <img> com texto alternativo (SVG isolado do CSS da página). */
export function TemplateImage({ asset, width = "100%", className, decorative }: TemplateImageProps) {
  return (
    <img
      className={cx("ln-template-img", className)}
      src={svgToDataUri(asset.svg)}
      alt={decorative ? "" : asset.alt}
      width={asset.width}
      height={asset.height}
      loading="lazy"
      decoding="async"
      style={{ width, height: "auto", aspectRatio: `${asset.width} / ${asset.height}`, display: "block" }}
      data-template={asset.kind}
      data-mock={asset.mock}
    />
  );
}
