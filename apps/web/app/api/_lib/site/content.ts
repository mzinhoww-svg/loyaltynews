// Conteúdo dos documentos do site (home, menus, SEO, links internos): validação estrita (zod) e regras de publicação.
// Nada aqui executa HTML: só dados (rótulos, caminhos, URLs http/https, slugs, ids de posição publicitária).
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { EditoriaSlug } from '@ln/contracts';
import { POSITIONS } from '@ln/commercial';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { HttpUrl, Slug } from '../schemas';

export const SITE_TIPOS = ['home', 'menu_principal', 'menu_rodape', 'seo_global', 'links_internos'] as const;
export type SiteTipo = (typeof SITE_TIPOS)[number];
export const SiteTipoSchema = z.enum(SITE_TIPOS);

/** Caminhos que o site nunca expõe em menu, redirect ou link interno. */
const RESERVADO = /^\/(api|studio|_next)(\/|$)/i;

/** Caminho interno do portal: começa com `/`, sem `//`, sem esquema, sem espaços; fora de /api, /studio e /_next. */
export const CaminhoInterno = z
  .string()
  .min(1)
  .max(300)
  .regex(/^\/(?!\/)[A-Za-z0-9._~\-/%?#=&:@+,;]*$/, 'caminho interno inválido')
  .refine((p) => !RESERVADO.test(p), 'caminho reservado');

/** Destino de navegação: caminho interno ou URL http(s). */
export const Destino = z.union([CaminhoInterno, HttpUrl.max(500)]);

const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40);

// ---------- home ----------
const POSICOES = POSITIONS.map((p) => p.id) as [string, ...string[]];
const Bloco = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('destaque'), id: Id, titulo: z.string().trim().max(80).optional(), materiaSlugs: z.array(Slug).min(1).max(8) }),
  z.strictObject({ tipo: z.literal('lista_editoria'), id: Id, titulo: z.string().trim().max(80).optional(), editoria: EditoriaSlug, limite: z.number().int().min(1).max(12).default(6) }),
  z.strictObject({ tipo: z.literal('ultimas'), id: Id, titulo: z.string().trim().max(80).optional(), limite: z.number().int().min(1).max(20).default(10) }),
  z.strictObject({ tipo: z.literal('agenda'), id: Id, titulo: z.string().trim().max(80).optional(), limite: z.number().int().min(1).max(10).default(5) }),
  z.strictObject({ tipo: z.literal('publicidade'), id: Id, posicao: z.enum(POSICOES) }),
]);

export const HomeContent = z
  .strictObject({ blocos: z.array(Bloco).min(1).max(20) })
  .superRefine((h, ctx) => {
    const ids = new Set<string>();
    h.blocos.forEach((b, i) => {
      if (ids.has(b.id)) ctx.addIssue({ code: 'custom', path: ['blocos', i, 'id'], message: 'id de bloco repetido' });
      ids.add(b.id);
    });
    const slugs = h.blocos.flatMap((b) => (b.tipo === 'destaque' ? b.materiaSlugs : []));
    if (new Set(slugs).size !== slugs.length) ctx.addIssue({ code: 'custom', path: ['blocos'], message: 'a mesma matéria fixada em mais de um destaque' });
    const pos = h.blocos.flatMap((b) => (b.tipo === 'publicidade' ? [b.posicao] : []));
    if (new Set(pos).size !== pos.length) ctx.addIssue({ code: 'custom', path: ['blocos'], message: 'a mesma posição publicitária em mais de um bloco' });
  });
export type HomeContentT = z.infer<typeof HomeContent>;

// ---------- menus ----------
const Item = z.strictObject({ rotulo: z.string().trim().min(1).max(40), destino: Destino });
const MenuItem = z.strictObject({ rotulo: z.string().trim().min(1).max(40), destino: Destino, filhos: z.array(Item).max(10).default([]) });
export const MenuContent = z.strictObject({ itens: z.array(MenuItem).min(1).max(12) });

// ---------- SEO ----------
export const SeoContent = z.strictObject({
  tituloPadrao: z.string().trim().min(1).max(70),
  descricaoPadrao: z.string().trim().min(1).max(200),
  imagemOgUrl: HttpUrl.max(500).optional(),
  /** `noindex` desliga a indexação do site inteiro (robots, meta e sitemap vazio). */
  indexacao: z.enum(['indexar', 'noindex']),
  sitemap: z.strictObject({ incluirMaterias: z.boolean() }),
  dadosEstruturados: z.strictObject({
    organizacao: z.strictObject({
      nome: z.string().trim().min(1).max(120),
      url: HttpUrl.max(300),
      logoUrl: HttpUrl.max(500).optional(),
      sameAs: z.array(HttpUrl.max(300)).max(10).default([]),
    }),
  }),
});

export type SeoContentT = z.infer<typeof SeoContent>;

export const LinksInternosContent = z
  .strictObject({ regras: z.array(z.strictObject({ termo: z.string().trim().min(2).max(60), destino: CaminhoInterno })).max(100) })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.regras.forEach((r, i) => {
      const k = r.termo.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['regras', i, 'termo'], message: 'termo repetido' });
      seen.add(k);
    });
  });

export const CONTEUDO: Record<SiteTipo, z.ZodType> = {
  home: HomeContent,
  menu_principal: MenuContent,
  menu_rodape: MenuContent,
  seo_global: SeoContent,
  links_internos: LinksInternosContent,
};

/** Quem pode escrever e publicar cada tipo: home e menus são da chefia; SEO e links internos, da redação (publica só a chefia). */
export const CHEFIA_ONLY: ReadonlySet<SiteTipo> = new Set<SiteTipo>(['home', 'menu_principal', 'menu_rodape']);

export interface Pendencia { path: string; message: string }

/**
 * Regras que dependem do estado do sistema, checadas ao PUBLICAR (e no preview): matérias fixadas existem e estão
 * publicadas; posições publicitárias têm dimensão reservada (sem dimensão a página saltaria ao carregar o anúncio).
 */
export async function pendenciasDePublicacao(db: Db, tipo: SiteTipo, conteudo: unknown): Promise<Pendencia[]> {
  const out: Pendencia[] = [];
  if (tipo === 'home') {
    const h = conteudo as HomeContentT;
    const slugs = [...new Set(h.blocos.flatMap((b) => (b.tipo === 'destaque' ? b.materiaSlugs : [])))];
    if (slugs.length) {
      const found = await db
        .select({ slug: schema.articles.slug, status: schema.articles.status, classe: schema.articles.classeDeDado })
        .from(schema.articles)
        .where(inArray(schema.articles.slug, slugs));
      for (const s of slugs) {
        const a = found.find((f) => f.slug === s);
        if (!a) out.push({ path: `materiaSlugs.${s}`, message: 'matéria inexistente' });
        else if ((a.status !== 'publicado' && a.status !== 'corrigido') || a.classe !== 'public') out.push({ path: `materiaSlugs.${s}`, message: `matéria não publicada (${a.status})` });
      }
    }
    for (const b of h.blocos) {
      if (b.tipo !== 'publicidade') continue;
      const p = POSITIONS.find((x) => x.id === b.posicao);
      if (!p?.desktop) out.push({ path: `blocos.${b.id}.posicao`, message: `${b.posicao} sem dimensão configurada: não reserva espaço` });
    }
  }
  return out;
}

/** Dimensão reservada de uma posição publicitária (para o portal reservar o espaço antes do anúncio carregar). */
export function dimensaoReservada(posicao: string): { desktop: string | null; mobile: string[] } | null {
  const p = POSITIONS.find((x) => x.id === posicao);
  return p ? { desktop: p.desktop, mobile: [...p.mobile] } : null;
}
