'use server';

// Watchlists pelas rotas do Backend (/api/studio/intelligence/watchlists|alerts): RBAC, dono e auditoria são os da API.
// O guard aqui só evita chamar a rota com papel que ela recusaria; a decisão final é sempre do Backend.
import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro, type RespostaApi } from '@/lib/studio/backend';
import { erroDoNome, tipoDeEntidade } from '@/lib/studio/watchlists-view';
import { requireStudio } from '../../_lib/guard';
import { texto } from '../../_lib/flash';

const BASE = '/studio/watchlists';
const ESCRITA = ['admin', 'editor_chefe', 'editor'] as const; // entidades:create/update
// Decisão do PM (23/11): o alerta é revisado pelo DONO da lista. Dono só pode ser quem cria lista (admin, editor-chefe, editor);
// a rota já entrega só os alertas das listas do próprio usuário, então o revisor nunca revisa alerta de outro.
const REVISAO = ESCRITA;

/** Volta para a lista aberta (se houver) com o aviso; id só de UUID para não montar URL com texto do formulário. */
function voltar(lista: string, ok: boolean, msg: string): never {
  const q = new URLSearchParams({ tipo: ok ? 'ok' : 'err', aviso: msg });
  if (/^[0-9a-f-]{36}$/i.test(lista)) q.set('lista', lista);
  redirect(`${BASE}?${q.toString()}`);
}
const resultado = (lista: string, r: RespostaApi<unknown>, sucesso: string): never => voltar(lista, !ehErro(r), ehErro(r) ? mensagemErro(r) : sucesso);

export async function criarWatchlistAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const nome = texto(fd, 'nome');
  const erro = erroDoNome(nome);
  if (erro) voltar('', false, erro);
  const r = await api.intelligence.criarWatchlist(nome);
  resultado(ehErro(r) ? '' : r.body.id, r, 'Watchlist criada.');
}

export async function apagarWatchlistAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const id = texto(fd, 'lista');
  if (texto(fd, 'confirmo') !== 'sim') voltar(id, false, 'Marque a confirmação para apagar a watchlist.');
  const r = await api.intelligence.apagarWatchlist(id);
  resultado('', r, 'Watchlist apagada, com seus itens e alertas. Os Moves continuam no Intelligence.');
}

export async function adicionarItemAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const lista = texto(fd, 'lista');
  const tipo = tipoDeEntidade(texto(fd, 'tipoEntidade'));
  if (!tipo) voltar(lista, false, 'Tipo de entidade inválido.');
  const r = await api.intelligence.adicionarItem(lista, tipo, texto(fd, 'entidade'));
  resultado(lista, r, 'Entidade adicionada à watchlist.');
}

export async function removerItemAction(fd: FormData): Promise<void> {
  await requireStudio(ESCRITA);
  const lista = texto(fd, 'lista');
  const tipo = tipoDeEntidade(texto(fd, 'tipoEntidade'));
  if (!tipo) voltar(lista, false, 'Tipo de entidade inválido.');
  const r = await api.intelligence.removerItem(lista, tipo, texto(fd, 'entidade'));
  resultado(lista, r, 'Entidade removida da watchlist.');
}

export async function revisarAlertaAction(fd: FormData): Promise<void> {
  await requireStudio(REVISAO);
  const status = texto(fd, 'status') === 'approved' ? 'approved' : 'rejected';
  const r = await api.intelligence.revisarAlerta(texto(fd, 'id'), status);
  resultado(texto(fd, 'lista'), r, status === 'approved' ? 'Alerta aprovado.' : 'Alerta rejeitado.');
}
