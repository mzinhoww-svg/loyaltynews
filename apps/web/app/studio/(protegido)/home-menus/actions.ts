'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import {
  HOME_PADRAO, MENU_PADRAO, editarBloco, editarItem, mover, novoBloco, remover, removerFilho,
  type HomeConteudo, type MenuConteudo, type TipoDoc,
} from '@/lib/studio/site-docs';
import { requireStudio } from '../../_lib/guard';

const t = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
/** Matérias do destaque: as marcadas no seletor, mais os slugs digitados (campo avançado). Sem repetir. */
const slugsDoForm = (fd: FormData): string => [...new Set([...fd.getAll('materiaSlug').map((x) => String(x).trim()), ...t(fd, 'materiaSlugs').split(/[\s,]+/)].filter(Boolean))].join(',');
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
    else if (op === 'editar-bloco') {
      const campos: Record<string, string> = {};
      for (const k of ['titulo', 'editoria', 'limite', 'posicao']) campos[k] = t(fd, k);
      campos.materiaSlugs = slugsDoForm(fd);
      novo = { blocos: h.blocos.map((b, k) => (k === i ? editarBloco(b, campos) : b)) };
      msg = 'Bloco alterado no rascunho (ainda não publicado).';
    } else if (op === 'adicionar') {
      const campos: Record<string, string> = {};
      for (const k of ['id', 'titulo', 'editoria', 'limite', 'posicao']) campos[k] = t(fd, k);
      campos.materiaSlugs = slugsDoForm(fd);
      const novoB = novoBloco(t(fd, 'blocoTipo'), campos, h.blocos.map((b) => b.id));
      // bloco repetido: a home não ganha nada com dois iguais (auditoria P2-08)
      const repetido = h.blocos.find((b) => b.tipo === novoB.tipo && (novoB.tipo === 'agenda' || novoB.tipo === 'ultimas' || (novoB.tipo === 'lista_editoria' && b.tipo === 'lista_editoria' && b.editoria === novoB.editoria)));
      if (repetido) return volta(tipo, false, novoB.tipo === 'lista_editoria' ? 'Já existe um bloco desta editoria: edite o existente.' : `Já existe um bloco de ${novoB.tipo === 'agenda' ? 'Agenda' : 'Últimas'}: edite o existente em vez de repetir.`);
      novo = { blocos: [...h.blocos, novoB] };
    } else if (op === 'iniciar') msg = 'Rascunho criado a partir do conteúdo atual.';
  } else {
    const m = atual as MenuConteudo;
    if (op === 'mover') novo = { itens: mover(m.itens, i, dir) };
    else if (op === 'remover') novo = { itens: remover(m.itens, i) };
    else if (op === 'adicionar') novo = { itens: [...m.itens, { rotulo: t(fd, 'rotulo'), destino: t(fd, 'destino'), filhos: [] }] };
    else if (op === 'editar-item') {
      novo = { itens: editarItem(m.itens, i, { rotulo: t(fd, 'rotulo'), destino: t(fd, 'destino') }) };
      msg = 'Item alterado no rascunho (ainda não publicado).';
    } else if (op === 'remover-filho') novo = { itens: removerFilho(m.itens, i, Number(t(fd, 'filho'))) };
    else if (op === 'adicionar-filho') novo = { itens: m.itens.map((it, k) => (k === i ? { ...it, filhos: [...it.filhos, { rotulo: t(fd, 'rotulo'), destino: t(fd, 'destino') }] } : it)) };
    else if (op === 'iniciar') msg = 'Rascunho criado a partir do conteúdo atual.';
  }
  const r = await api.site.salvarRascunho(tipo, novo);
  volta(tipo, !ehErro(r), ehErro(r) ? mensagemErro(r) : msg);
}
