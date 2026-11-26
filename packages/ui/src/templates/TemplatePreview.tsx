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
  /**
   * URL da Inter variável do próprio app (ex.: /fonts/inter-var.woff2). Só o PNG usa:
   * a fonte é embutida no SVG rasterizado para o texto não cair em Arial.
   * Cards do Growth (texto em curvas) não precisam dela.
   */
  fontUrl?: string;
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

const ERRO_FONTE = "fonte_indisponivel";
const ERRO_FONTE_AUSENTE = "fonte_nao_configurada";
const fontesCarregadas = new Map<string, Promise<string>>();

/** Busca a fonte uma vez e devolve um data URI; falha alto para o PNG não sair com outra fonte. */
async function fonteComoDataUri(url: string): Promise<string> {
  let pendente = fontesCarregadas.get(url);
  if (!pendente) {
    pendente = (async () => {
      const resposta = await fetch(url);
      if (!resposta.ok) throw new Error(ERRO_FONTE);
      const bytes = new Uint8Array(await resposta.arrayBuffer());
      let binario = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:font/woff2;base64,${btoa(binario)}`;
    })();
    fontesCarregadas.set(url, pendente);
    pendente.catch(() => fontesCarregadas.delete(url));
  }
  return pendente;
}

/** Converte o SVG em PNG no navegador (o rasterizador do servidor não é usado aqui). */
async function svgParaPng(asset: TemplateAsset, fontUrl?: string): Promise<Blob> {
  let svg = asset.svg;
  if (/<text[\s>]/.test(svg)) {
    if (!fontUrl) throw new Error(ERRO_FONTE_AUSENTE);
    // @font-face dentro do SVG: o canvas recebe o documento isolado, então a fonte da página não vale.
    const fonte = await fonteComoDataUri(fontUrl);
    svg = svg.replace(
      /(<svg[^>]*>)/,
      `$1<style>@font-face{font-family:'Inter Variable';src:url(${fonte}) format('woff2');font-weight:100 900;font-style:normal}</style>`,
    );
  }
  const origem = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((ok, falha) => {
    img.onload = () => ok();
    img.onerror = () => falha(new Error("o navegador não conseguiu desenhar o SVG"));
    img.src = origem;
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
export function TemplatePreview({ asset, copy, caption, className, fontUrl, onExport }: TemplatePreviewProps) {
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
      baixar(await svgParaPng(asset, fontUrl), nomeDeArquivo(base, "png"));
      setMensagem("PNG baixado.");
      onExport?.("png");
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : "";
      if (motivo === ERRO_FONTE) {
        setMensagem("Não foi possível carregar a fonte da marca; o PNG não foi gerado para não sair em Arial.");
      } else if (motivo === ERRO_FONTE_AUSENTE) {
        setMensagem("Esta peça usa texto com fonte: configure fontUrl para gerar o PNG sem cair em Arial.");
      } else {
        setMensagem("Não foi possível gerar o PNG neste navegador. Use o SVG ou tente em outro navegador.");
      }
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
