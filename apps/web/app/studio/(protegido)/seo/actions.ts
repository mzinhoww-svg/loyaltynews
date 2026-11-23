'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { LINKS_PADRAO, linhasParaLista, type LinksConteudo, type SeoConteudo } from '@/lib/studio/site-docs';
import { CHEFIA_EDITORIAL, ESCRITA_EDITORIAL } from '@/lib/studio/papeis';
import { requireStudio } from '../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
const volta = (ok: boolean, msg: string): never => redirect(`/studio/seo?tipoMsg=${ok ? 'ok' : 'err'}&aviso=${encodeURIComponent(msg)}`);

async function conteudoBase<T>(tipo: string, padrao: T): Promise<T> {
  const r = await api.site.documento(tipo);
  if (!ehErro(r)) {
    const d = (r.body as { data: { rascunho: { conteudo: T } | null; vigente: { conteudo: T } | null } }).data;
    return d.rascunho?.conteudo ?? d.vigente?.conteudo ?? padrao;
  }
  return padrao;
}

/** SEO global: grava o RASCUNHO (a redação escreve; só a chefia publica). Campo opcional vazio é omitido. */
export async function salvarSeoAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA_EDITORIAL);
  const opc = (k: string) => t(fd, k) || undefined;
  const conteudo: SeoConteudo = {
    tituloPadrao: t(fd, 'tituloPadrao'),
    descricaoPadrao: t(fd, 'descricaoPadrao'),
    ...(opc('imagemOgUrl') ? { imagemOgUrl: opc('imagemOgUrl')! } : {}),
    indexacao: t(fd, 'indexacao') === 'noindex' ? 'noindex' : 'indexar',
    sitemap: { incluirMaterias: t(fd, 'incluirMaterias') === 'on' },
    dadosEstruturados: {
      organizacao: {
        nome: t(fd, 'orgNome'),
        url: t(fd, 'orgUrl'),
        ...(opc('orgLogoUrl') ? { logoUrl: opc('orgLogoUrl')! } : {}),
        sameAs: linhasParaLista(t(fd, 'orgSameAs')),
      },
    },
  };
  const r = await api.site.salvarRascunho('seo_global', conteudo);
  volta(!ehErro(r), ehErro(r) ? mensagemErro(r) : 'Rascunho do SEO salvo (ainda não publicado).');
}

export async function adicionarLinkAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA_EDITORIAL);
  const atual = await conteudoBase<LinksConteudo>('links_internos', LINKS_PADRAO);
  const r = await api.site.salvarRascunho('links_internos', { regras: [...atual.regras, { termo: t(fd, 'termo'), destino: t(fd, 'destino') }] });
  volta(!ehErro(r), ehErro(r) ? mensagemErro(r) : 'Regra de link interno adicionada ao rascunho.');
}

export async function removerLinkAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA_EDITORIAL);
  const atual = await conteudoBase<LinksConteudo>('links_internos', LINKS_PADRAO);
  const i = Number(t(fd, 'indice'));
  const r = await api.site.salvarRascunho('links_internos', { regras: atual.regras.filter((_, k) => k !== i) });
  volta(!ehErro(r), ehErro(r) ? mensagemErro(r) : 'Regra removida do rascunho.');
}

/** Redirecionamentos: criar e alterar exigem chefia/admin (site:publish); excluir só admin. Laço ou cadeia longa: o Backend recusa (409). */
export async function criarRedirectAction(fd: FormData): Promise<void> {
  await requireStudio(CHEFIA_EDITORIAL);
  const r = await api.site.criarRedirect({ origem: t(fd, 'origem'), destino: t(fd, 'destino'), codigo: Number(t(fd, 'codigo')) === 302 ? 302 : 301 });
  volta(!ehErro(r), ehErro(r) ? mensagemErro(r) : 'Redirecionamento criado.');
}

export async function alternarRedirectAction(fd: FormData): Promise<void> {
  await requireStudio(CHEFIA_EDITORIAL);
  const r = await api.site.alterarRedirect(t(fd, 'id'), { ativo: t(fd, 'ativo') === 'true' });
  volta(!ehErro(r), ehErro(r) ? mensagemErro(r) : t(fd, 'ativo') === 'true' ? 'Redirecionamento ativado.' : 'Redirecionamento desativado.');
}

export async function removerRedirectAction(fd: FormData): Promise<void> {
  await requireStudio(['admin']);
  const r = await api.site.excluirRedirect(t(fd, 'id'));
  volta(!ehErro(r), ehErro(r) ? mensagemErro(r) : 'Redirecionamento removido.');
}
