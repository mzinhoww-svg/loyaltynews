'use server';

// Registro da leitura do leitor 1 pela rota da Editorial (auditada; correção = nova versão). Nenhuma ação publica.
import { redirect } from 'next/navigation';
import { api } from '@/lib/studio/rotas-api';
import { ehErro, mensagemErro } from '@/lib/studio/backend';
import { achadosDoFormulario, ehMateria } from '@/lib/studio/piloto-view';
import { requireStudio } from '../../_lib/guard';
import { texto } from '../../_lib/flash';

function voltar(materia: string, ok: boolean, msg: string): never {
  const base = ehMateria(materia) ? `/studio/piloto/${materia}` : '/studio/piloto';
  redirect(`${base}?${new URLSearchParams({ tipo: ok ? 'ok' : 'err', aviso: msg }).toString()}`);
}

export async function registrarLeituraAction(fd: FormData): Promise<void> {
  await requireStudio(['admin', 'editor_chefe']);
  const materia = texto(fd, 'materia');
  if (!ehMateria(materia)) voltar('', false, 'Matéria inválida.');
  const linhas = [0, 1, 2, 3, 4].map((i) => ({ trecho: texto(fd, `trecho${i}`), tipo: texto(fd, `tipo${i}`), gravidade: texto(fd, `gravidade${i}`), evidenciaId: texto(fd, `evidencia${i}`) }));
  const a = achadosDoFormulario(linhas);
  if (!a.ok) voltar(materia, false, a.erro);
  const veredito = texto(fd, 'veredito');
  if (veredito !== 'aprovado' && veredito !== 'bloqueado') voltar(materia, false, 'Marque o veredito: aprovada ou bloqueada.');
  const checklist = { fatosNasEvidencias: texto(fd, 'fatosNasEvidencias') === 'sim', tom: texto(fd, 'tom') === 'sim', nadaInventado: texto(fd, 'nadaInventado') === 'sim' };
  const r = await api.piloto.registrar(materia, { leitor: 1, achados: a.achados, checklist, veredito });
  voltar(materia, !ehErro(r), ehErro(r) ? mensagemErro(r) : `Leitura registrada e auditada: ${a.achados.length} fato(s) não suportado(s).`);
}
