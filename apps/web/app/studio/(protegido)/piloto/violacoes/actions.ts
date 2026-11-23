'use server';

// Resolução de violação do piloto pelo admin (PM-2026-11-23-D), pela rota do Backend 1: auditada, não apaga a linha.
import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { erroDaResolucao } from '@/lib/studio/piloto-violacoes';
import { requireStudio } from '../../../_lib/guard';
import { texto } from '../../../_lib/flash';

const BASE = '/studio/piloto/violacoes';
function voltar(ok: boolean, msg: string): never {
  redirect(`${BASE}?${new URLSearchParams({ tipo: ok ? 'ok' : 'err', aviso: msg }).toString()}`);
}

export async function resolverViolacaoAction(fd: FormData): Promise<void> {
  await requireStudio(['admin']);
  const taskId = texto(fd, 'taskId');
  const attempt = Number(texto(fd, 'attempt'));
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(taskId) || !Number.isInteger(attempt) || attempt < 0) voltar(false, 'Linha inválida.');
  const lista = await api.piloto.linhas();
  if (ehErro(lista)) voltar(false, mensagemErro(lista));
  const linha = lista.body.items.find((l) => l.task_id === taskId && l.attempt === attempt);
  if (!linha) voltar(false, 'Linha do piloto não encontrada.');
  const acao = texto(fd, 'acao') === 'outra' ? texto(fd, 'acaoOutra') : texto(fd, 'acao');
  const motivo = texto(fd, 'motivo');
  const e = erroDaResolucao(linha, motivo, acao);
  if (e) voltar(false, e);
  if (texto(fd, 'confirmo') !== 'sim') voltar(false, 'Marque a confirmação: a resolução é definitiva e fica na trilha de auditoria.');
  const r = await api.piloto.resolverViolacao(taskId, attempt, { motivo, acaoTomada: acao });
  if (ehErro(r)) voltar(false, mensagemErro(r));
  voltar(true, r.body.jaResolvida ? `A linha ${taskId} (tentativa ${attempt}) já estava resolvida; nada mudou.` : `Violação da linha ${taskId} (tentativa ${attempt}) resolvida e auditada. A linha continua na planilha e conta no critério.`);
}
