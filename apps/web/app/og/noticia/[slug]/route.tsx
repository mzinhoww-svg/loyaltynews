import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { getEditoria } from '../../../(portal)/_lib/editorias';
import { getSource } from '../../../(portal)/_lib/source';
import { OG_COLORS, OgCardRefusal, planejarOgCard } from '../../../../lib/og-card';

/**
 * OG image por matéria (1200×630, PNG real via next/og), desenhada com os tokens do design system.
 * Fica FORA de app/(portal)/noticia/[slug] de propósito: um opengraph-image.tsx de convenção
 * venceria o metadata.openGraph da página e apagaria a imagem publicada no Studio.
 * A página só aponta para cá quando a matéria não tem imagem própria e a manchete cabe.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FONTES = ['inter-og-regular.ttf', 'inter-og-bold.ttf'] as const;

/** Lê a Inter estática do pacote de marca; o start da Vertra roda na raiz do repo, o npm workspace em apps/web. */
function fonte(nome: string): Buffer {
  const raiz = process.cwd();
  const caminhos = [join(raiz, 'public', 'fonts', nome), join(raiz, 'apps', 'web', 'public', 'fonts', nome)];
  for (const caminho of caminhos) {
    // O Turbopack não precisa rastrear o projeto inteiro: os TTF vivem em public/, que é copiado para o deploy.
    if (existsSync(/* turbopackIgnore: true */ caminho)) return readFileSync(/* turbopackIgnore: true */ caminho);
  }
  throw new Error(`fonte de OG ausente: ${nome}`);
}

let fontes: { regular: Buffer; bold: Buffer } | null = null;
function carregarFontes() {
  fontes ??= { regular: fonte(FONTES[0]), bold: fonte(FONTES[1]) };
  return fontes;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { article } = await getSource().getArticle(slug);
  if (!article) return new Response('matéria não encontrada', { status: 404 });

  const editoria = getEditoria(article.editoriaSlug)?.name ?? article.editoriaSlug;
  let plano;
  try {
    plano = planejarOgCard({ title: article.title, editoria, credit: article.authorLabel, publishedAt: article.publishedAt });
  } catch (erro) {
    if (erro instanceof OgCardRefusal) return new Response(erro.message, { status: 422 });
    throw erro;
  }

  const { regular, bold } = carregarFontes();
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: OG_COLORS.background,
          padding: '64px 72px 56px',
          fontFamily: 'Inter',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 54, height: 8, backgroundColor: OG_COLORS.eyebrow }} />
          <div style={{ fontSize: 30, fontWeight: 700, color: OG_COLORS.headline, letterSpacing: 2 }}>LOYALTY NEWS</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: OG_COLORS.eyebrow, letterSpacing: 3, marginBottom: 22 }}>{plano.eyebrow}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {plano.lines.map((linha, i) => (
              <div key={i} style={{ fontSize: plano.fontSize, fontWeight: 700, lineHeight: `${plano.lineHeight}px`, color: OG_COLORS.headline }}>
                {linha}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${OG_COLORS.footer}`, paddingTop: 20 }}>
          <div style={{ fontSize: 24, color: OG_COLORS.footer }}>
            {[plano.credit, plano.dateLabel].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: OG_COLORS.headline }}>{plano.site}</div>
        </div>
      </div>
    ),
    {
      width: plano.width,
      height: plano.height,
      fonts: [
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      ],
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    },
  );
}
