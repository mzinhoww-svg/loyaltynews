'use server';

import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { PAPEIS_COMERCIAIS } from '@/lib/studio/comercial';
import { requireStudio } from '../../_lib/guard';
import { texto, voltar } from '../../_lib/flash';

export async function criarCampanhaAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const r = await api.comercial.criarCampanha({
    name: texto(fd, 'nome'),
    accountId: texto(fd, 'conta'),
    formatId: texto(fd, 'formato'),
    startDate: texto(fd, 'inicio'),
    endDate: texto(fd, 'fim'),
    sponsoredLabel: fd.get('rotulo') === 'on',
  });
  if (ehErro(r)) return voltar('/studio/campanhas', { ok: false, erros: [mensagemErro(r)] }, '');
  const id = (r.body as { id: string }).id;
  redirect(`/studio/campanhas/${encodeURIComponent(id)}?tipo=ok&aviso=${encodeURIComponent('Campanha criada em rascunho.')}`);
}

export async function transicaoAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const para = texto(fd, 'para');
  // 'reserved' exige as reservas da campanha: o domínio confere que existem, não estão canceladas e são desta campanha
  let reservationIds: string[] | undefined;
  if (para === 'reserved') {
    const d = await api.comercial.campanha(id);
    if (ehErro(d)) return voltar(`/studio/campanhas/${encodeURIComponent(id)}`, { ok: false, erros: [mensagemErro(d)] }, '');
    reservationIds = ((d.body as { reservations?: { id: string; status: string }[] }).reservations ?? []).filter((x) => x.status !== 'cancelled').map((x) => x.id);
  }
  const r = await api.comercial.transicaoCampanha({ campaignId: id, to: para, ...(reservationIds ? { reservationIds } : {}), ...(texto(fd, 'nota') ? { note: texto(fd, 'nota') } : {}) });
  voltar(`/studio/campanhas/${encodeURIComponent(id)}`, ehErro(r) ? { ok: false, erros: [mensagemErro(r)] } : { ok: true }, 'Estado da campanha atualizado.');
}

const voltarCampanha = (id: string, r: Parameters<typeof ehErro>[0], ok: string) =>
  voltar(`/studio/campanhas/${encodeURIComponent(id)}`, ehErro(r) ? { ok: false, erros: [mensagemErro(r)] } : { ok: true }, ok);

/** Posição da campanha: pré-reserva (held). Confirmar é venda e exige a flag adServerVendas (o domínio recusa sem ela). */
export async function reservarPosicaoAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const r = await api.comercial.reservar({
    campaignId: id,
    accountId: texto(fd, 'conta'),
    positionId: texto(fd, 'posicao'),
    startDate: texto(fd, 'inicio'),
    endDate: texto(fd, 'fim'),
    confirm: fd.get('confirmar') === 'on',
  });
  voltarCampanha(id, r, 'Posição reservada.');
}

export async function cancelarReservaAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  voltarCampanha(texto(fd, 'id'), await api.comercial.cancelarReserva(texto(fd, 'reserva')), 'Reserva cancelada.');
}

/** Criativo novo (ainda sem arquivo): posição, período, alt, anunciante e destino. Nasce não aprovado. */
export async function adicionarCriativoAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const opc = (k: string, campo: string) => (texto(fd, k) ? { [campo]: texto(fd, k) } : {});
  const r = await api.comercial.adicionarCriativo({
    campaignId: id,
    positionId: texto(fd, 'posicao'),
    startDate: texto(fd, 'inicio'),
    endDate: texto(fd, 'fim'),
    ...opc('alt', 'altText'),
    ...opc('destino', 'destinationUrl'),
    ...opc('anunciante', 'advertiserName'),
  });
  voltarCampanha(id, r, 'Criativo adicionado (não aprovado).');
}

/** Arquivo do criativo: tipo, dimensões, peso e hash medidos no servidor; trocar o arquivo revoga a aprovação. */
export async function enviarArquivoCriativoAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const arquivo = fd.get('arquivo');
  if (!(arquivo instanceof File) || arquivo.size === 0) return voltar(`/studio/campanhas/${encodeURIComponent(id)}`, { ok: false, erros: ['Escolha o arquivo do criativo.'] }, '');
  const form = new FormData();
  form.set('creativeId', texto(fd, 'criativo'));
  form.set('arquivo', arquivo);
  voltarCampanha(id, await api.comercial.enviarArquivoCriativo(form), 'Arquivo do criativo enviado (precisa aprovar de novo).');
}

export async function aprovarCriativoAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  voltarCampanha(texto(fd, 'id'), await api.comercial.aprovarCriativo(texto(fd, 'criativo')), 'Criativo aprovado.');
}

/** Posições da campanha (checkboxes). O domínio recusa fora de rascunho, posição não configurada ou formato indisponível. */
export async function definirPosicoesAction(fd: FormData): Promise<void> {
  await requireStudio(PAPEIS_COMERCIAIS);
  const id = texto(fd, 'id');
  const ids = fd.getAll('posicoes').filter((v): v is string => typeof v === 'string' && v.length > 0);
  voltarCampanha(id, await api.comercial.definirPosicoes(id, ids), 'Posições da campanha atualizadas.');
}
