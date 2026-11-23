'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import {
  HOME_PADRAO, MENU_PADRAO, mover, novoBloco, remover,
  type HomeConteudo, type MenuConteudo, type TipoDoc,
} from '@/lib/studio/site-docs';
import { requireStudio } from '../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
const TIPOS: readonly TipoDoc[] = ['home', 'menu_principal', 'menu_rodape'];

const volta = (tipo: string, ok: boolean, msg: string): never => redirect(`/studio/home-menus?tipo=${tipo}&tipoMsg=${ok ? 'ok' : 'err'}&aviso=${encodeURIComponent(msg)}`);

/** Base da edição: rascunho atual; senão a versão em vigor; senão o padrão mínimo. Nada é publicado: só o rascunho muda. */
async function base(tipo: TipoDoc): Promise<unknown> {
  const r = await api.site.documento(tipo);
  if (!ehErro(r)) {
    const d = (r.body as { data: { rascunho: { conteudo: unknown } | null; vigente: { conteudo: unknown } | null } }).data;
    if (d.rascunho) return d.rascunho.conteudo;
    if (d.vigente) return d.vigente.conteudo;
  }
  return tipo === 'home' ? HOME_PADRAO : MENU_PADRAO;
}

/** Edições estruturadas do rascunho de home e menus. A validação é do Backend: recusa volta como mensagem. */
export async function editarDocAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const tipo = t(fd, 'tipo') as TipoDoc;
  if (!TIPOS.includes(tipo)) return volta('home', false, 'Documento desconhecido.');
  const op = t(fd, 'op');
  const i = Number(t(fd, 'indice'));
  const dir = t(fd, 'dir') === 'up' ? -1 : 1;
  const atual = await base(tipo);
  let novo: unknown = atual;
  let msg = 'Rascunho salvo (ainda não publicado).';
  if (tipo === 'home') {
    const h = atual as HomeConteudo;
    if (op === 'mover') novo = { blocos: mover(h.blocos, i, dir) };
    else if (op === 'remover') novo = { blocos: remover(h.blocos, i) };
    else if (op === 'adicionar') {
      const campos: Record<string, string> = {};
      for (const k of ['id', 'titulo', 'materiaSlugs', 'editoria', 'limite', 'posicao']) campos[k] = t(fd, k);
      novo = { blocos: [...h.blocos, novoBloco(t(fd, 'blocoTipo'), campos, h.blocos.map((b) => b.id))] };
    } else if (op === 'iniciar') msg = 'Rascunho criado a partir do conteúdo atual.';
  } else {
    const m = atual as MenuConteudo;
    if (op === 'mover') novo = { itens: mover(m.itens, i, dir) };
    else if (op === 'remover') novo = { itens: remover(m.itens, i) };
    else if (op === 'adicionar') novo = { itens: [...m.itens, { rotulo: t(fd, 'rotulo'), destino: t(fd, 'destino'), filhos: [] }] };
    else if (op === 'adicionar-filho') novo = { itens: m.itens.map((it, k) => (k === i ? { ...it, filhos: [...it.filhos, { rotulo: t(fd, 'rotulo'), destino: t(fd, 'destino') }] } : it)) };
    else if (op === 'iniciar') msg = 'Rascunho criado a partir do conteúdo atual.';
  }
  const r = await api.site.salvarRascunho(tipo, novo);
  volta(tipo, !ehErro(r), ehErro(r) ? mensagemErro(r) : msg);
}
