"use client";

import { useState } from "react";
import { cx } from "../utils";
import { TemplateImage } from "./TemplateImage";
import type { TemplateAsset } from "./core";

export interface TemplatePreviewCopy {
  editoria: string;
  title: string;
  credit?: string;
  dateLabel?: string;
}

export interface TemplatePreviewProps {
  /** Peça já renderizada (thumbnail/capa/lower third do UI ou card social do Growth, adaptado pela tela). */
  asset: TemplateAsset;
  /** Campos editoriais exibidos abaixo da peça. */
  copy?: TemplatePreviewCopy;
  caption?: string;
  className?: string;
  /** Avisa a tela depois de um download (formato já entregue ao usuário). */
  onExport?: (formato: "svg" | "png") => void;
}

/** Nome de arquivo sem separador de caminho e sem caractere reservado do sistema. */
export function nomeDeArquivo(base: string, extensao: "svg" | "png"): string {
  const limpo = base
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${limpo || "peca"}.${extensao}`;
}

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Converte o SVG em PNG no navegador (o rasterizador do servidor não é usado aqui). */
async function svgParaPng(asset: TemplateAsset): Promise<Blob> {
  const fonte = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svg)}`;
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((ok, falha) => {
    img.onload = () => ok();
    img.onerror = () => falha(new Error("o navegador não conseguiu desenhar o SVG"));
    img.src = fonte;
  });
  const canvas = document.createElement("canvas");
  canvas.width = asset.width;
  canvas.height = asset.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d indisponível");
  ctx.drawImage(img, 0, 0, asset.width, asset.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) throw new Error("o navegador não gerou o PNG");
  return blob;
}

/**
 * Prévia e exportação de uma peça social/editorial (item 2): usa o TemplateAsset existente
 * (com mock, brandStatus e brandVersion) e o TemplateImage, para o selo MOCK e o alt não sumirem.
 * O PNG é gerado no navegador; a tela decide se usa esta rota ou a rota de servidor do Studio.
 */
export function TemplatePreview({ asset, copy, caption, className, onExport }: TemplatePreviewProps) {
  const [mensagem, setMensagem] = useState("");
  const base = asset.filename?.trim() || `${asset.kind}-${asset.width}x${asset.height}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(asset.svg);
      setMensagem("SVG copiado.");
    } catch {
      setMensagem("Não foi possível copiar o SVG. Selecione o código e copie manualmente.");
    }
  };

  const baixarSvg = () => {
    try {
      baixar(new Blob([asset.svg], { type: "image/svg+xml;charset=utf-8" }), nomeDeArquivo(base, "svg"));
      setMensagem("SVG baixado.");
      onExport?.("svg");
    } catch {
      setMensagem("Não foi possível baixar o SVG.");
    }
  };

  const baixarPng = async () => {
    try {
      baixar(await svgParaPng(asset), nomeDeArquivo(base, "png"));
      setMensagem("PNG baixado.");
      onExport?.("png");
    } catch {
      setMensagem("Não foi possível gerar o PNG neste navegador. Use o SVG ou tente em outro navegador.");
    }
  };

  return (
    <section className={cx("ln-preview", className)} aria-label={copy ? `Prévia: ${copy.title}` : "Prévia da peça"} data-brand-status={asset.brandStatus}>
      <TemplateImage asset={asset} className="ln-preview__image" />
      {copy ? (
        <div className="ln-preview__meta">
          <p className="ln-preview__eyebrow">{copy.editoria}</p>
          <p className="ln-preview__title">{copy.title}</p>
          <p className="ln-preview__details">{[copy.credit, copy.dateLabel].filter(Boolean).join(" · ")}</p>
        </div>
      ) : null}
      {caption ? <p className="ln-preview__caption">{caption}</p> : null}
      <div className="ln-preview__actions">
        <button type="button" className="ln-btn ln-btn--secondary" onClick={copiar}>
          Copiar SVG
        </button>
        <button type="button" className="ln-btn ln-btn--secondary" onClick={baixarSvg}>
          Baixar SVG
        </button>
        <button type="button" className="ln-btn ln-btn--secondary" onClick={baixarPng}>
          Baixar PNG
        </button>
      </div>
      <p className="ln-preview__status" role="status" aria-live="polite">
        {mensagem}
      </p>
    </section>
  );
}
